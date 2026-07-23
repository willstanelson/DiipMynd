// ============================================================================
// DiipMynd — Admin Sessions Monitor: Manual Force-End
// POST /api/admin/sessions/end
//
// Admin-auth-gated manual end for an active stream session. Separate from
// /api/stream/end because that route is scoped to session.user_id ===
// currentUser.id and would 403 for an admin acting on someone else's session.
//
// Two modes:
//   "graceful" → settle_stream_session(sessionId, actualCost, "success")
//                — bill for actual usage, refund the remainder.
//   "force"    → settle_stream_session(sessionId, 0, "failure")
//                — full refund, for visibly stuck / broken sessions.
//
// actualCost is clamped to amount_reserved from day one (no legacy behavior to
// preserve) — settle_reservation rejects p_actual_cost > amount_reserved on
// the "success" path, which would roll back the entire transaction and leave
// the session stuck (the exact Bug #1 failure mode).
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

interface SessionRow {
  id: string;
  user_id: string;
  started_at: string;
  connected_at: string | null;
  last_known_generation_seconds: number | null;
  status: string;
}

interface ReservationRow {
  amount_reserved: number;
}

export async function POST(request: Request) {
  try {
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { sessionId, mode } = body;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
    }

    if (mode !== "graceful" && mode !== "force") {
      return NextResponse.json({ error: "mode must be 'graceful' or 'force'." }, { status: 400 });
    }

    // 1. Fetch the session.
    const { data: session, error: fetchErr } = await supabaseAdmin
      .from("stream_sessions")
      .select("id, user_id, started_at, connected_at, last_known_generation_seconds, status")
      .eq("id", sessionId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[admin-sessions-end] Failed to fetch session:", fetchErr.message);
      return NextResponse.json({ error: "Failed to fetch session." }, { status: 500 });
    }

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const typedSession = session as SessionRow;

    if (typedSession.status !== "active") {
      return NextResponse.json({
        success: true,
        message: "Session is already ended.",
        mode,
      });
    }

    // 2. Resolve outcome + actualCost.
    // Force mode is a full refund: outcome "failure" makes settle_reservation
    // ignore p_actual_cost and refund amount_reserved in full.
    // Graceful mode bills for actual usage, clamped to the reservation.
    const outcome = mode === "force" ? "failure" : "success";
    let actualCost = 0;

    if (mode === "graceful") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("is_admin")
        .eq("id", typedSession.user_id)
        .maybeSingle();

      const isTargetAdmin = !!profile?.is_admin;

      if (isTargetAdmin) {
        // Admins don't have reservations — just mark the session ended below.
        actualCost = 0;
      } else {
        // Fetch the reservation explicitly (no FK; reference_id is TEXT) and
        // clamp. This is the same contract the settlement paths enforce.
        const { data: reservation } = await supabaseAdmin
          .from("credit_reservations")
          .select("amount_reserved")
          .eq("reference_type", "stream")
          .eq("reference_id", sessionId)
          .maybeSingle();

        const now = new Date();
        const startTime = typedSession.connected_at
          ? new Date(typedSession.connected_at)
          : new Date(typedSession.started_at);
        const wallClockSeconds = Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));
        // 3.3: prefer Decart's authoritative cumulative seconds (persisted via
        // keepalive) over the wall-clock estimate when available. The clamp
        // stays as the final safety net regardless.
        const elapsedSeconds = typedSession.last_known_generation_seconds ?? wallClockSeconds;

        const amountReserved = (reservation as ReservationRow | null)?.amount_reserved ?? elapsedSeconds;
        actualCost = Math.min(elapsedSeconds, amountReserved);
      }
    }

    // 3. Settle atomically (or, for admin targets, just flip status since they
    // have no reservation). settle_stream_session is a no-op on the reservation
    // side when no reserved row exists, so it's safe to call unconditionally —
    // but for admin targets the direct update is clearer and matches
    // /api/stream/end's admin branch.
    if (actualCost === 0 && outcome === "success") {
      // Graceful end of an admin session: no reservation to settle.
      const { error: updateErr } = await supabaseAdmin
        .from("stream_sessions")
        .update({ status: "ended" })
        .eq("id", sessionId);
      if (updateErr) {
        throw new Error(`Failed to end admin session: ${updateErr.message}`);
      }
    } else {
      const { error: settleErr } = await supabaseAdmin.rpc("settle_stream_session", {
        p_session_id: sessionId,
        p_actual_cost: actualCost,
        p_outcome: outcome,
      });

      if (settleErr) {
        console.error(`[admin-sessions-end] settle_stream_session failed (${mode}):`, settleErr.message);
        return NextResponse.json({ error: "Failed to settle session." }, { status: 500 });
      }
    }

    console.log(
      `[admin-sessions-end] Admin ${adminUser.id} ended session ${sessionId} ` +
      `(mode: ${mode}, billed: ${actualCost}s).`
    );

    return NextResponse.json({
      success: true,
      message: `Session ended via ${mode} mode.`,
      mode,
      billedSeconds: actualCost,
    });
  } catch (err) {
    return apiError(err, "Failed to end session.", 500);
  }
}
