import { test, expect, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const testUserEmail = process.env.TEST_USER_EMAIL!;
const cronSecret = process.env.CRON_SECRET!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

test.describe.configure({ mode: 'serial' });

test.describe("Billing Security and Escrow Verification", () => {
  let userId: string;
  let sharedPage: Page;

  test.beforeAll(async ({ browser }) => {
    // 1. Fetch test user ID
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", testUserEmail)
      .single();
    
    if (error || !profile) {
      throw new Error(`Test user profile not found for email ${testUserEmail}`);
    }
    userId = profile.id;

    // 2. Launch single browser context and perform login ONCE
    const context = await browser.newContext();
    sharedPage = await context.newPage();

    await sharedPage.goto("/");
    await sharedPage.fill('input[type="email"]', testUserEmail);
    await sharedPage.fill('input[type="password"]', process.env.TEST_USER_PASSWORD!);
    await sharedPage.click('button[type="submit"]');
    await sharedPage.waitForSelector('#btn-nav-stream');
  });

  test.beforeEach(async () => {
    // Force the user to be a non-admin to trigger standard credit/escrow paths
    await supabaseAdmin.from("profiles").update({ is_admin: false }).eq("id", userId);
    // Clean up any lingering stream sessions
    await supabaseAdmin.from("stream_sessions").delete().eq("user_id", userId);
  });

  test.afterAll(async () => {
    // 1. Delete all reservations created by the test user to leave audit log clean
    await supabaseAdmin.from("credit_reservations").delete().eq("user_id", userId);
    // 2. Restore credits balance to 100
    await supabaseAdmin.from("profiles").update({ credits: 100 }).eq("id", userId);
    // 3. Restore admin privilege to the test user profile
    await supabaseAdmin.from("profiles").update({ is_admin: true }).eq("id", userId);
    
    if (sharedPage) {
      await sharedPage.close();
    }
  });

  test("Test 1: 402 Gate on Zero Balance (Fal Proxy)", async () => {
    // 1. Set test user's balance to 0
    await supabaseAdmin.from("profiles").update({ credits: 0 }).eq("id", userId);

    // 2. Hit the proxy directly (shares login cookies on sharedPage)
    const res = await sharedPage.request.post("/api/fal/proxy", {
      headers: {
        "x-fal-target-url": "https://queue.fal.run/fal-ai/flux-realism"
      },
      data: {
        prompt: "test prompt"
      }
    });

    // 3. Verify 402 Payment Required
    expect(res.status()).toBe(402);
    const json = await res.json();
    expect(json.error).toContain("Insufficient credits to process request.");
    expect(json.required).toBe(10);
    expect(json.available).toBe(0);
  });

  test("Test 2: Reserve -> Settle Success Round Trip (Mocked)", async () => {
    // 1. Set user credits to 100
    await supabaseAdmin.from("profiles").update({ credits: 100 }).eq("id", userId);

    // 2. Hit proxy requesting mock success response
    const res = await sharedPage.request.post("/api/fal/proxy", {
      headers: {
        "x-fal-target-url": "https://queue.fal.run/fal-ai/flux-realism",
        "x-test-mock": "success"
      },
      data: {
        prompt: "test prompt"
      }
    });

    // 3. Verify 200 OK and correct final balance (100 - 10 = 90)
    expect(res.status()).toBe(200);
    
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();
    expect(profile?.credits).toBe(90);
  });

  test("Test 2 (Failure): Reserve -> Settle Failure Round Trip (Refund)", async () => {
    // 1. Set user credits to 100
    await supabaseAdmin.from("profiles").update({ credits: 100 }).eq("id", userId);

    // 2. Hit proxy requesting mock error response
    const res = await sharedPage.request.post("/api/fal/proxy", {
      headers: {
        "x-fal-target-url": "https://queue.fal.run/fal-ai/flux-realism",
        "x-test-mock": "failure"
      },
      data: {
        prompt: "test prompt"
      }
    });

    // 3. Verify 500 and refunded balance (100)
    expect(res.status()).toBe(500);
    
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();
    expect(profile?.credits).toBe(100);
  });

  test("Test 3: Orphaned Reservation Reconciliation", async () => {
    test.setTimeout(90000);

    // 1. Set user credits to 30
    await supabaseAdmin.from("profiles").update({ credits: 30 }).eq("id", userId);

    // 2. Start a Decart streaming session (will reserve 30 credits with 30s TTL)
    const startRes = await sharedPage.request.post("/api/stream/start", {
      data: {
        provider: "decart"
      }
    });
    expect(startRes.status()).toBe(200);
    const startJson = await startRes.json();
    expect(startJson.success).toBe(true);

    // 3. Verify credits are locked in escrow (balance is 0)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();
    expect(profile?.credits).toBe(0);

    // 4. Wait 32 seconds for the reservation to expire
    console.log("Waiting 32 seconds for stream reservation to expire...");
    await new Promise((resolve) => setTimeout(resolve, 32000));

    // 5. Trigger the reconciliation cron
    const cronRes = await sharedPage.request.post("/api/worker/reconcile-reservations", {
      headers: {
        "Authorization": `Bearer ${cronSecret}`
      }
    });
    expect(cronRes.status()).toBe(200);
    const cronJson = await cronRes.json();
    expect(cronJson.success).toBe(true);
    expect(cronJson.processed).toBeGreaterThanOrEqual(1);

    // 6. Verify credits are refunded (balance restored to 30)
    const { data: profileAfter } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();
    expect(profileAfter?.credits).toBe(30);
  });

  test("Test 4: Concurrent Duplicate Reservation (Idempotency / Race Condition)", async () => {
    // 1. Give test user enough credits
    await supabaseAdmin.from("profiles").update({ credits: 100 }).eq("id", userId);

    // 2. Execute concurrently using database RPC calls directly
    const referenceId = `race-${Date.now()}`;
    const [res1Result, res2Result] = await Promise.all([
      supabaseAdmin.rpc("reserve_credits", {
        p_user_id: userId,
        p_amount: 10,
        p_reference_type: "job",
        p_reference_id: referenceId,
        p_ttl_seconds: 120
      }),
      supabaseAdmin.rpc("reserve_credits", {
        p_user_id: userId,
        p_amount: 10,
        p_reference_type: "job",
        p_reference_id: referenceId,
        p_ttl_seconds: 120
      })
    ]);

    expect(res1Result.error).toBeNull();
    expect(res2Result.error).toBeNull();

    const data1 = Array.isArray(res1Result.data) ? res1Result.data[0] : res1Result.data as any;
    const data2 = Array.isArray(res2Result.data) ? res2Result.data[0] : res2Result.data as any;

    // 3. Verify idempotency: both should succeed and yield the exact same reservationId
    expect(data1.ok).toBe(true);
    expect(data2.ok).toBe(true);
    expect(data1.reservation_id).not.toBeNull();
    expect(data1.reservation_id).toBe(data2.reservation_id);

    // Clean up the created reservation
    if (data1 && data1.ok && data1.reservation_id) {
      await supabaseAdmin.rpc("settle_reservation", {
        p_reservation_id: data1.reservation_id,
        p_actual_cost: 0,
        p_outcome: "failure"
      });
    }
  });

  test("Test 5: RLS Blocks Client-Side stream_sessions Insert", async () => {
    // 1. Initialize client-side supabase client using anon key
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    // 2. Authenticate as the test user
    const { error: authError } = await supabaseClient.auth.signInWithPassword({
      email: testUserEmail,
      password: process.env.TEST_USER_PASSWORD!
    });
    expect(authError).toBeNull();

    // 3. Attempt direct insert into stream_sessions
    const { error } = await supabaseClient
      .from('stream_sessions')
      .insert({ user_id: userId, provider: 'decart' });

    // 4. Verify it is blocked by RLS
    expect(error).not.toBeNull();
    const isRlsError = error!.message.toLowerCase().includes("row-level security policy") ||
                       error!.message.toLowerCase().includes("permission denied");
    expect(isRlsError).toBe(true);
  });

  test("Test 6: Vercel Cron Configuration Check", async () => {
    const fs = require("fs");
    const path = require("path");
    const vercelConfigPath = path.resolve(__dirname, "../vercel.json");

    // 1. Verify vercel.json exists
    expect(fs.existsSync(vercelConfigPath)).toBe(true);

    // 2. Read and parse configuration
    const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, "utf-8"));
    expect(vercelConfig.crons).toBeDefined();
    expect(Array.isArray(vercelConfig.crons)).toBe(true);

    // 3. Find the reconciliation cron
    const reconcileCron = vercelConfig.crons.find((c: any) => c.path === "/api/worker/reconcile-reservations");
    expect(reconcileCron).toBeDefined();
    expect(reconcileCron.schedule).toBeDefined();

    // 4. Verify formatting
    expect(reconcileCron.path).toBe("/api/worker/reconcile-reservations");
  });
});
