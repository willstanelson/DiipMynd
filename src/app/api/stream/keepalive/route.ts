// ============================================================================
// DiipMynd — Stream API: Keep-Alive + Opportunistic Billing Sweep
// POST /api/stream/keepalive
//
// 1. Updates the current user's session keepalive timestamp.
// 2. Returns session timing info for client-side credit countdown.
// 3. Opportunistically sweeps for ANY stale sessions (from all users) and
//    settles their reservations using the atomic SQL RPC.
// ============================================================================

import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { apiError } from "@/lib/api";

const STALE_AFTER_SECONDS = 90; // match billing worker constant

export async function POST() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // Modest rate limit: 1 keepalive / 5s per user (cheap DB writes, but unbounded).
    const limited = await checkRateLimit(`keepalive_${currentUser.id}`, 1, 5 * 1000, {
      failOpen: true, // best-effort — don't kill a live stream on a DB blip
    });
    if (limited) {
      return NextResponse.json(
        { error: "Keep-alive rate limit exceeded." },
        { status: 429 }
      );
    }

    // .maybeSingle() is safe if zero or one row matches; .single() would 500
    // if the user somehow has >1 active session. Fixes L7.
    const { data, error } = await supabaseAdmin
      .from("stream_sessions")
      .update({ last_keepalive_at: new Date().toISOString() })
      .eq("user_id", currentUser.id)
      .eq("status", "active")
      .select("id, started_at")
      .maybeSingle();

    if (error || !data) {
      // The session is no longer active (ended by billing worker on timeout / 0 credits).
      return NextResponse.json({ error: "Session is gone or ended." }, { status: 410 });
    }

    // Check associated reservation hold (if not admin)
    let reservationExpiresAt: string | null = null;
    let amountReserved: number | null = null;

    if (!currentUser.isAdmin) {
      const { data: reservation } = await supabaseAdmin
        .from("credit_reservations")
        .select("status, expires_at, amount_reserved")
        .eq("reference_type", "stream")
        .eq("reference_id", data.id)
        .maybeSingle();

      if (reservation && reservation.status !== "reserved") {
        // Force-end the session row since hold has been released or expired
        await supabaseAdmin.rpc("settle_stream_session", {
          p_session_id: data.id,
          p_actual_cost: 0,
          p_outcome: "failure"
        });
        
        return NextResponse.json({ error: "Session credit hold expired or released." }, { status: 410 });
      }

      if (reservation) {
        reservationExpiresAt = reservation.expires_at;
        amountReserved = reservation.amount_reserved;
      }
    }

    // ── Opportunistic Stale Session Sweep ──────────────────────────────────
    // Since Vercel Hobby plan doesn't support frequent crons, we piggyback
    // stale-session detection onto every keepalive call.
    // Wrapped in after() to guarantee lambda stays warm until it completes.
    after(() => {
      sweepStaleSessions().catch((err) => {
        console.error("[keepalive] Background stale sweep error:", err);
      });
    });

    // ── Compute session timing for client-side countdown ──────────────────
    const now = new Date();
    const startedAt = new Date(data.started_at);
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));

    return NextResponse.json({
      success: true,
      message: "Keep-alive registered.",
      sessionId: data.id,
      elapsedSeconds,
      amountReserved,
      reservationExpiresAt,
    });
  } catch (err) {
    return apiError(err, "Failed to register keep-alive.", 500);
  }
}

// ── Lightweight Stale Session Sweep ─────────────────────────────────────────
// Runs at most once every 30 seconds (globally, per server lambda instance).
// Finds active sessions with no keepalive in >90 seconds and settles them atomically.
let lastSweepTime = 0;
const SWEEP_INTERVAL_MS = 30_000;
const SWEEP_BATCH_LIMIT = 10; // small batch to keep database sweep fast

async function sweepStaleSessions() {
  const now = Date.now();
  if (now - lastSweepTime < SWEEP_INTERVAL_MS) return;
  lastSweepTime = now;

  const cutoff = new Date(now - STALE_AFTER_SECONDS * 1000).toISOString();

  const { data: staleSessions, error } = await supabaseAdmin
    .from("stream_sessions")
    .select("id, user_id, started_at, last_keepalive_at")
    .eq("status", "active")
    .lt("last_keepalive_at", cutoff)
    .limit(SWEEP_BATCH_LIMIT);

  if (error) {
    console.error("[keepalive-sweep] Failed to fetch stale active sessions:", error.message);
    return;
  }

  if (!staleSessions || staleSessions.length === 0) return;

  for (const session of staleSessions) {
    try {
      // Check for admin exemption
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("is_admin")
        .eq("id", session.user_id)
        .maybeSingle();

      const isAdmin = !!profile?.is_admin;

      const startedAt = new Date(session.started_at);
      const lastKeepalive = new Date(session.last_keepalive_at);
      const elapsedSeconds = Math.max(0, Math.floor(
        (lastKeepalive.getTime() - startedAt.getTime()) / 1000
      ));

      if (isAdmin) {
        // Admins don't have reservations, just mark ended
        await supabaseAdmin
          .from("stream_sessions")
          .update({ status: "ended" })
          .eq("id", session.id);
        console.log(`[keepalive-sweep] Ended stale admin session ${session.id}.`);
        continue;
      }

      // Non-admins: call the atomic RPC to settle session and reservation together!
      const { data: settleResult, error: settleErr } = await supabaseAdmin.rpc("settle_stream_session", {
        p_session_id: session.id,
        p_actual_cost: elapsedSeconds,
        p_outcome: "success"
      });

      if (settleErr) {
        console.error(`[keepalive-sweep] Failed to settle stale session RPC ${session.id}:`, settleErr.message);
      } else {
        console.log(
          `[keepalive-sweep] Atomic settled stale session ${session.id}. ` +
          `Duration: ${elapsedSeconds}s. Result:`, settleResult
        );
      }
    } catch (err) {
      console.error(`[keepalive-sweep] Failed to process stale session ${session.id}:`, err);
    }
  }
}
