// ============================================================================
// DiipMynd — Backend: Paystack Payment Verification Handler
// GET /api/credits/verify-payment?reference=xxx
//
// This endpoint manually verifies a Paystack checkout transaction reference.
// It is called by the frontend upon redirect to ensure immediate crediting
// and feedback (toasts) without waiting for webhook delivery.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

// Credit packages mapping (matching checkout definitions)
const PACKAGE_CREDITS: Record<string, number> = {
  trial: 600,       // 10 minutes
  starter: 1800,    // 30 minutes
  standard: 3600,   // 1 hour
  pro: 18000,       // 5 hours
};

export async function GET(request: Request) {
  try {
    // ── Guard: Authenticate user ─────────────────────────────────────────
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // ── Guard: Extract reference ──────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const reference = searchParams.get("reference");

    if (!reference) {
      return NextResponse.json({ error: "Transaction reference is required." }, { status: 400 });
    }

    console.log(`[verify-payment] Verifying transaction reference: ${reference} for user ${currentUser.email}`);

    // ── Check if already processed (Idempotency) ──────────────────────────
    const { data: existingLog, error: fetchLogErr } = await supabaseAdmin
      .from("credit_requests")
      .select("id, status")
      .eq("tx_hash", reference)
      .maybeSingle();

    if (fetchLogErr) {
      console.error("[verify-payment] DB log fetch error:", fetchLogErr.message);
    }

    if (existingLog) {
      if (existingLog.status === "approved") {
        console.log(`[verify-payment] Reference ${reference} already approved and processed.`);
        return NextResponse.json({ success: true, message: "Payment already processed." });
      }
      // If it's pending, let's proceed to verify and update
    }

    // ── Verify with Paystack API ──────────────────────────────────────────
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      console.error("[verify-payment] PAYSTACK_SECRET_KEY is missing.");
      return NextResponse.json({ error: "Processor key is missing on the server." }, { status: 500 });
    }

    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      console.error("[verify-payment] Paystack API error:", paystackData);
      return NextResponse.json({ error: paystackData.message || "Failed to verify transaction." }, { status: 400 });
    }

    const { status: paystackStatus, amount, metadata, customer, channel } = paystackData.data;

    // ── Guard: Check payment status ──────────────────────────────────────
    if (paystackStatus !== "success") {
      console.warn(`[verify-payment] Paystack transaction status is: ${paystackStatus}`);
      return NextResponse.json({
        success: false,
        message: `Transaction was not successful. Status: ${paystackStatus}`,
      });
    }

    // ── Guard: Verify DiipMynd metadata ───────────────────────────────────
    const { product, userId, packageId } = metadata || {};
    if (product !== "diipmynd" || !userId || !packageId) {
      console.warn("[verify-payment] Metadata mismatch: Not a DiipMynd session.", metadata);
      return NextResponse.json({ error: "Invalid transaction metadata." }, { status: 400 });
    }

    // Ensure we are crediting the correct user (currentUser)
    if (userId !== currentUser.id) {
      console.warn(`[verify-payment] User ID mismatch. Metadata: ${userId}, Session: ${currentUser.id}`);
      return NextResponse.json({ error: "User session mismatch." }, { status: 403 });
    }

    const creditsToAdd = PACKAGE_CREDITS[packageId];
    if (!creditsToAdd) {
      console.error(`[verify-payment] Invalid package ID in metadata: ${packageId}`);
      return NextResponse.json({ error: "Invalid package identifier." }, { status: 400 });
    }

    // ── Credit User Profile & Insert/Update Log Idempotently ─────────────
    // Fetch profile to get current credits
    const { data: profile, error: selectError } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", currentUser.id)
      .single();

    if (selectError || !profile) {
      console.error("[verify-payment] Failed to load profile credits:", selectError?.message);
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    const newCredits = profile.credits + creditsToAdd;

    // Perform database updates
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", currentUser.id);

    if (updateError) {
      console.error("[verify-payment] Failed to credit profile:", updateError.message);
      return NextResponse.json({ error: "Failed to credit profile." }, { status: 500 });
    }

    // Upsert or insert into credit_requests to mark it approved
    if (existingLog) {
      const { error: logUpdateError } = await supabaseAdmin
        .from("credit_requests")
        .update({ status: "approved" })
        .eq("id", existingLog.id);
      
      if (logUpdateError) {
        console.error("[verify-payment] Failed to update credit_requests status:", logUpdateError.message);
      }
    } else {
      const { error: logInsertError } = await supabaseAdmin
        .from("credit_requests")
        .insert({
          user_id: currentUser.id,
          email: customer?.email || currentUser.email,
          package_id: packageId,
          amount: creditsToAdd,
          status: "approved",
          payment_method: `Paystack (${channel || "card"})`,
          tx_hash: reference,
        });

      if (logInsertError) {
        console.error("[verify-payment] Failed to log request:", logInsertError.message);
      }
    }

    console.log(`[verify-payment] Successfully credited user ${currentUser.email} with ${creditsToAdd} credits.`);
    return NextResponse.json({ success: true, credits: newCredits });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal verification error.";
    console.error("[verify-payment] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
