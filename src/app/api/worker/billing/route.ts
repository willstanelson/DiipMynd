// ============================================================================
// DiipMynd — Worker: Stream Billing
// POST /api/worker/billing  (CRON_SECRET protected)
//
// Auth: requires a valid CRON_SECRET header.
//
// Refactored to support the credit reservation escrow pattern:
//   * Active stream sessions are checked against their credit_reservations.
//   * Stale sessions (no keepalive > 90s) are ended and settled for their actual elapsed time.
//   * Sessions exceeding their hard reservation expiration time are terminated.
//   * Admins are exempt from billing holds but sessions are still marked stale.
// ============================================================================

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { apiError, requireCronAuth } from "@/lib/api";
import { settleReservationEscrow } from "@/lib/credits";

export const maxDuration = 300;

const STALE_AFTER_SECONDS = 90; // end sessions with no recent keepalive

export async function POST() {
  const authFail = await requireCronAuth();
  if (authFail) return authFail;

  try {
    // 1. Fetch a bounded batch of active sessions.
    const { data: sessions, error: fetchError } = await supabaseAdmin
      .from("stream_sessions")
      .select("id, user_id, provider, started_at, connected_at, last_billed_at, last_keepalive_at")
      .eq("status", "active")
      .order("last_billed_at", { ascending: true })
      .limit(200);

    if (fetchError) {
      console.error("[worker/billing] Failed to fetch active sessions:", fetchError);
      return NextResponse.json({ error: "Failed to fetch active sessions" }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: "No active sessions." });
    }

    const now = new Date();
    let processed = 0;
    let ended = 0;

    for (const session of sessions) {
      const startedAt = new Date(session.started_at);
      const lastKeepalive = new Date(session.last_keepalive_at);

      const secondsSinceKeepalive = (now.getTime() - lastKeepalive.getTime()) / 1000;

      // ── Admin Exemption ──────────────────────────────────────────────────
      // Fetch user profile to check admin status
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("is_admin")
        .eq("id", session.user_id)
        .maybeSingle();

      const isAdmin = !!profile?.is_admin;

      // Never-connected guard: if connected_at is null the WebRTC stream never
      // established. The user consumed zero generation time.
      const neverConnected = !session.connected_at;

      // Fetch active reservation hold (if not admin)
      let reservation: any = null;
      if (!isAdmin) {
        const { data: resData } = await supabaseAdmin
          .from("credit_reservations")
          .select("id, amount_reserved, expires_at, status")
          .eq("reference_type", "stream")
          .eq("reference_id", session.id)
          .maybeSingle();
        
        reservation = resData;
      }

      // ── Staleness timeout — terminal ─────────────────────────────────────
      if (secondsSinceKeepalive > STALE_AFTER_SECONDS) {
        await supabaseAdmin.from("stream_sessions").update({ status: "ended" }).eq("id", session.id);
        
        if (reservation && reservation.status === "reserved") {
          // Never-connected sessions get a full refund (cost = 0, outcome = failure).
          const startTime = session.connected_at ? new Date(session.connected_at) : startedAt;
          const elapsedSeconds = neverConnected ? 0 : Math.max(0, Math.floor((lastKeepalive.getTime() - startTime.getTime()) / 1000));
          const actualCost = neverConnected ? 0 : Math.min(reservation.amount_reserved, elapsedSeconds);
          const outcome = neverConnected ? "failure" : "success";
          await settleReservationEscrow(reservation.id, actualCost, outcome);
        }
        ended++;
        continue;
      }

      // ── Check if reservation hold has expired or been settled ──────────────
      if (!isAdmin) {
        if (!reservation) {
          // Orphan session with no hold -> terminate
          await supabaseAdmin.from("stream_sessions").update({ status: "ended" }).eq("id", session.id);
          ended++;
          continue;
        }

        if (reservation.status !== "reserved") {
          // Hold was already settled or expired -> terminate session
          await supabaseAdmin.from("stream_sessions").update({ status: "ended" }).eq("id", session.id);
          ended++;
          continue;
        }

        const expiresAt = new Date(reservation.expires_at);
        if (now.getTime() >= expiresAt.getTime()) {
          // Hold expired -> terminate and settle for ACTUAL elapsed time, not
          // the full reservation amount. This prevents charging the full escrow
          // when a session that barely ran outlives its reservation TTL.
          const startTime = session.connected_at ? new Date(session.connected_at) : startedAt;
          const elapsedSeconds = neverConnected ? 0 : Math.max(0, Math.floor((lastKeepalive.getTime() - startTime.getTime()) / 1000));
          const actualCost = neverConnected ? 0 : Math.min(reservation.amount_reserved, elapsedSeconds);
          const outcome = neverConnected ? "failure" : "success";
          await supabaseAdmin.from("stream_sessions").update({ status: "ended" }).eq("id", session.id);
          await settleReservationEscrow(reservation.id, actualCost, outcome);
          ended++;
          continue;
        }
      }

      // ── Session is active and healthy ────────────────────────────────────
      await supabaseAdmin
        .from("stream_sessions")
        .update({ last_billed_at: now.toISOString() })
        .eq("id", session.id);
      processed++;
    }

    return NextResponse.json({ success: true, processed, ended });
  } catch (err) {
    return apiError(err, "Failed to run billing tick.", 500);
  }
}
