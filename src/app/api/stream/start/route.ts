// ============================================================================
// DiipMynd — Stream API: Start Stream Session
// POST /api/stream/start
//
// Initializes a stream session on the server. Checks credits, creates a
// credit reservation hold, inserts the session row in the database, and
// mints Decart connection tokens if needed.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { reserveCreditsEscrow } from "@/lib/credits";
import { getAppSetting } from "@/lib/appSettings";
import { createDecartClient } from "@decartai/sdk";
import { apiError } from "@/lib/api";
import crypto from "crypto";

const HARD_MAX_SESSION_SECONDS = 7200; // 2 hours hard cap

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { provider } = body;

    if (provider !== "decart" && provider !== "fal") {
      return NextResponse.json({ error: "Invalid provider. Must be 'decart' or 'fal'." }, { status: 400 });
    }

    let userCredits = currentUser.credits;

    // 1. Proactively clean up and settle any of the calling user's own active/stale sessions first.
    // This resolves the "low-traffic / solo-user" gap so their credits are refunded before checking balance.
    if (!currentUser.isAdmin) {
      const { data: oldSessions, error: activeFetchErr } = await supabaseAdmin
        .from("stream_sessions")
        .select("id, started_at, connected_at, last_known_generation_seconds")
        .eq("user_id", currentUser.id)
        .eq("status", "active");

      if (activeFetchErr) {
        console.error("[stream-start] Failed to check for active sessions:", activeFetchErr.message);
      } else if (oldSessions && oldSessions.length > 0) {
        let profileNeedsUpdate = false;
        for (const oldSess of oldSessions) {
          console.warn(`[stream-start] Proactively settling lingering session: ${oldSess.id}`);

          // Fetch the reservation explicitly (no FK from credit_reservations to
          // stream_sessions — reference_id is a TEXT column matched by convention)
          // and clamp actual cost. settle_reservation rejects p_actual_cost >
          // amount_reserved on the 'success' path, which rolls back the entire
          // settle_stream_session transaction and leaves the session stuck.
          // p_outcome must be exactly success/failure/expired — anything else
          // hits invalid_outcome and re-triggers the same rollback.
          const { data: reservation } = await supabaseAdmin
            .from("credit_reservations")
            .select("amount_reserved")
            .eq("reference_type", "stream")
            .eq("reference_id", oldSess.id)
            .maybeSingle();

          const startTime = oldSess.connected_at ? new Date(oldSess.connected_at) : new Date(oldSess.started_at);
          const wallClockSeconds = Math.max(0, Math.floor((Date.now() - startTime.getTime()) / 1000));
          // 3.3: prefer Decart's authoritative cumulative seconds (persisted via
          // keepalive) over the wall-clock estimate when available.
          const elapsedSeconds = oldSess.last_known_generation_seconds ?? wallClockSeconds;

          const amountReserved = reservation?.amount_reserved ?? elapsedSeconds;
          const actualCost = Math.min(elapsedSeconds, amountReserved);

          const { error: settleErr } = await supabaseAdmin.rpc("settle_stream_session", {
            p_session_id: oldSess.id,
            p_actual_cost: actualCost,
            p_outcome: "expired"
          });

          if (settleErr) {
            console.error(`[stream-start] Failed to settle session RPC ${oldSess.id}:`, settleErr.message);
          } else {
            profileNeedsUpdate = true;
          }
        }

        if (profileNeedsUpdate) {
          // Re-fetch the updated credits balance from the database
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("credits")
            .eq("id", currentUser.id)
            .maybeSingle();
          if (profile) {
            userCredits = profile.credits;
          }
        }
      }
    }

    // Minimum balance check: at least 30 credits (equivalent to 30s stream time)
    if (!currentUser.isAdmin && userCredits < 30) {
      return NextResponse.json({
        error: "Insufficient credits. Minimum 30 credits required to start streaming."
      }, { status: 402 });
    }

    // A user is either "still on the free KYC trial" (never topped up) or a
    // funded user — a single one-way flag, not a per-credit-unit distinction,
    // since paid and bonus credits become indistinguishable once they land
    // in the same fungible `credits` balance. Admins are always production.
    const isTestSession = !currentUser.isAdmin && !currentUser.hasFundedCredits;

    const sessionId = crypto.randomUUID();
    const estimatedCost = currentUser.isAdmin
      ? 0
      : Math.min(userCredits, HARD_MAX_SESSION_SECONDS);

    // 2. Reserve credits in escrow (if not admin)
    let reservationId: string | null = null;
    if (!currentUser.isAdmin) {
      const reservation = await reserveCreditsEscrow(
        currentUser.id,
        estimatedCost,
        "stream",
        sessionId,
        estimatedCost // TTL is equal to estimatedCost in seconds (1 credit = 1 second)
      );

      if (!reservation.ok) {
        return NextResponse.json({
          error: "Failed to reserve credits for streaming.",
          required: estimatedCost,
          available: reservation.available ?? 0
        }, { status: 402 });
      }
      reservationId = reservation.reservationId || null;
    }

    // 3. Insert stream session row server-side
    let insertResult = await supabaseAdmin
      .from("stream_sessions")
      .insert({
        id: sessionId,
        user_id: currentUser.id,
        provider,
        status: "active",
        started_at: new Date().toISOString(),
        last_billed_at: new Date().toISOString(),
        last_keepalive_at: new Date().toISOString(),
        is_test_session: isTestSession,
      })
      .select()
      .maybeSingle();

    let insertError = insertResult.error;

    if (insertError && insertError.code === "23505") {
      console.warn(`[stream-start] Active session constraint hit for user ${currentUser.id}. Resolving race...`);
      // Find the old active session(s) and end them
      const { data: oldSessions } = await supabaseAdmin
        .from("stream_sessions")
        .select("id")
        .eq("user_id", currentUser.id)
        .eq("status", "active");

      if (oldSessions && oldSessions.length > 0) {
        for (const oldSess of oldSessions) {
          console.warn(`[stream-start] Force ending orphan session: ${oldSess.id}`);
          const { error: settleErr } = await supabaseAdmin.rpc("settle_stream_session", {
            p_session_id: oldSess.id,
            p_actual_cost: 0,
            p_outcome: "failure"
          });
          if (settleErr) {
            console.error(`[stream-start] Failed to settle orphan session RPC:`, settleErr.message);
          }
        }
      }

      // Retry the insert once
      insertResult = await supabaseAdmin
        .from("stream_sessions")
        .insert({
          id: sessionId,
          user_id: currentUser.id,
          provider,
          status: "active",
          started_at: new Date().toISOString(),
          last_billed_at: new Date().toISOString(),
          last_keepalive_at: new Date().toISOString(),
          is_test_session: isTestSession,
        })
        .select()
        .maybeSingle();

      insertError = insertResult.error;
    }

    if (insertError) {
      if (
        insertError.message.includes("permission denied") ||
        insertError.message.includes("does not exist") ||
        insertError.message.includes("relation")
      ) {
        if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_MOCK_ESCROW !== "true") {
          throw new Error("CRITICAL: stream_sessions table not found or write denied. Simulated escrow fallback is disabled in non-development environments.");
        }
        console.warn("[stream-start] stream_sessions table insert denied or missing. Using simulated local session.");
        const { addMockStreamSession } = await import("@/lib/credits");
        addMockStreamSession(currentUser.id);
      } else {
        console.error("[stream-start] Database insert error:", insertError.message);
        // Refund if insertion fails
        if (reservationId) {
          const { settleReservationEscrow } = await import("@/lib/credits");
          await settleReservationEscrow(reservationId, estimatedCost, "failure");
        }
        return NextResponse.json({ error: "Failed to initialize stream session." }, { status: 500 });
      }
    }

    // 3. Setup Decart / Fal TTL & expiration details
    let decartToken: string | null = null;
    const tokenTtl = currentUser.isAdmin ? 300 : Math.min(300, estimatedCost + 60);
    const tokenExpiresAt = Date.now() + tokenTtl * 1000;
    const reservationExpiresAt = currentUser.isAdmin
      ? Date.now() + 86400 * 1000
      : Date.now() + estimatedCost * 1000;

    if (provider === "decart") {
      // Trial users are routed to a separate Decart account/key. That
      // second account is left at Decart's default — realtime output is
      // watermarked unless watermark removal is explicitly requested per
      // platform.decart.ai/watermark — so trial sessions are visibly
      // marked as such with zero extra work on our side. Rotating to a
      // fresh Decart account (once the current one's signup credits run
      // out) is just a POST to /api/admin/settings; no Vercel redeploy.
      const apiKey = isTestSession
        ? await getAppSetting("decart_api_key_test")
        : process.env.DECART_API_KEY;

      if (!apiKey) {
        console.error(
          isTestSession
            ? "[stream-start] Test session requested but decart_api_key_test is not configured."
            : "[stream-start] DECART_API_KEY is not configured."
        );
        // Fail closed rather than silently falling back to the production
        // key for a trial user — that would defeat the entire point of
        // this routing and quietly bill the real account for test traffic.
        return NextResponse.json({ error: "Decart integration is misconfigured." }, { status: 500 });
      }

      const client = createDecartClient({ apiKey });
      const token = await client.tokens.create({
        expiresIn: tokenTtl,
        allowedModels: ["lucy-2.5"],
        // Native hard cap: Decart itself will not generate a single second past
        // this duration, regardless of whether DiipMynd's client or backend runs
        // correctly. Safe to pass here because (a) Decart's documented floor is
        // 10s and the minimum-balance check above guarantees estimatedCost >= 30
        // for any non-admin session reaching this line, and (b) admins are
        // excluded entirely (estimatedCost is 0 for admins, below the floor).
        // Safe across reconnects: Bug #3's scheduleReconnect re-runs the full
        // startSession() flow, which settles the old session (refunding unused
        // credits via Part 1's clamp) before recomputing estimatedCost from the
        // genuinely-remaining balance — so a user cannot accrue more generation
        // time than they paid for by forcing reconnects.
        ...(currentUser.isAdmin ? {} : {
          constraints: { realtime: { maxSessionDuration: estimatedCost } },
        }),
      });

      const returnedKey = token?.apiKey;
      if (!returnedKey || returnedKey === apiKey) {
        throw new Error("Decart token generation returned an invalid key shape.");
      }

      decartToken = returnedKey;
    }

    return NextResponse.json({
      success: true,
      sessionId,
      decartToken,
      tokenExpiresAt,
      reservationExpiresAt,
      reservationId,
      isTestSession,
    });
  } catch (err) {
    return apiError(err, "Failed to start stream session.", 500);
  }
}
