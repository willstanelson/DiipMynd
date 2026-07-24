// ============================================================================
// DiipMynd — Stream API: End Stream Session
// POST /api/stream/end
//
// Gracefully terminates a stream session. Calculates the elapsed time/credits,
// updates the session status to 'ended', and settles the escrow reservation
// to refund any remaining unused balance.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { settleReservationEscrow } from "@/lib/credits";
import { apiError } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    let body;
    try {
      const text = await request.text();
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
    }

    // 1. Fetch active session
    let session: any = null;
    const { data: dbSession, error: fetchErr } = await supabaseAdmin
      .from("stream_sessions")
      .select("id, started_at, connected_at, status, user_id, last_known_generation_seconds")
      .eq("id", sessionId)
      .single();

    if (fetchErr) {
      if (
        fetchErr.message.includes("permission denied") ||
        fetchErr.message.includes("does not exist") ||
        fetchErr.message.includes("relation")
      ) {
        if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_MOCK_ESCROW !== "true") {
          throw new Error("CRITICAL: stream_sessions table not found or read denied. Simulated escrow fallback is disabled in non-development environments.");
        }
        console.warn("[stream-end] stream_sessions table read denied or missing. Checking simulated local session.");
        const { hasMockStreamSession, removeMockStreamSession } = require("@/lib/credits");
        if (hasMockStreamSession(currentUser.id)) {
          session = {
            id: sessionId,
            started_at: new Date(Date.now() - 10000).toISOString(), // simulated 10s session duration
            status: "active",
            user_id: currentUser.id
          };
          removeMockStreamSession(currentUser.id);
        }
      } else {
        return NextResponse.json({ error: "Failed to fetch stream session." }, { status: 500 });
      }
    } else {
      session = dbSession;
    }

    if (!session) {
      return NextResponse.json({ error: "Stream session not found." }, { status: 404 });
    }

    if (session.user_id !== currentUser.id) {
      return NextResponse.json({ error: "Unauthorized access to session." }, { status: 403 });
    }

    if (session.status !== "active") {
      return NextResponse.json({ success: true, message: "Session already ended." });
    }

    // 2. Calculate actual cost based on elapsed seconds (relative to connected_at, falling back to started_at)
    const now = new Date();

    // ── Never-connected guard ─────────────────────────────────────────────
    // If connected_at is null the WebRTC session never established. The user
    // consumed zero generation time, so the actual cost is unconditionally 0
    // and the full escrow hold must be refunded.
    const neverConnected = !session.connected_at;

    const startTime = session.connected_at ? new Date(session.connected_at) : new Date(session.started_at);
    const wallClockSeconds = neverConnected ? 0 : Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));
    // 3.3: prefer Decart's authoritative cumulative seconds over the wall-clock
    // estimate when available. The clamp (below) stays as the final safety net
    // regardless of which estimate is used.
    const elapsedSeconds = neverConnected ? 0 : (session.last_known_generation_seconds ?? wallClockSeconds);

    // 3. Settle session and reservation atomically via RPC
    if (currentUser.isAdmin) {
      // Admins don't have reservations, just mark ended
      const { error: updateErr } = await supabaseAdmin
        .from("stream_sessions")
        .update({ status: "ended" })
        .eq("id", sessionId);
      if (updateErr) {
        throw new Error(`Failed to end admin stream session: ${updateErr.message}`);
      }
      console.log(`[stream-end] Ended admin session ${sessionId}`);
    } else {
      // Fetch the reservation explicitly — credit_reservations has no FK to
      // stream_sessions (reference_id is a plain TEXT column matched by convention),
      // so this must be a separate query, not a nested-select embed.
      const { data: reservation } = await supabaseAdmin
        .from("credit_reservations")
        .select("amount_reserved")
        .eq("reference_type", "stream")
        .eq("reference_id", sessionId)
        .maybeSingle();

      // Clamp actual cost to the reserved amount. settle_reservation rejects
      // (invalid_actual_cost) when p_actual_cost > amount_reserved, which rolls
      // back the entire settle_stream_session transaction and leaves the session
      // stuck "active". This clamp guarantees the contract holds even when a
      // session runs past its reservation window.
      const amountReserved = reservation?.amount_reserved ?? elapsedSeconds;
      const actualCost = Math.min(elapsedSeconds, amountReserved);
      const outcome = neverConnected ? "failure" : "success";

      const { data: settleResult, error: settleErr } = await supabaseAdmin.rpc("settle_stream_session", {
        p_session_id: sessionId,
        p_actual_cost: actualCost,
        p_outcome: outcome
      });

      if (settleErr) {
        console.error(`[stream-end] Failed to settle session atomically:`, settleErr.message);
        return NextResponse.json({ error: "Failed to settle reservation hold." }, { status: 500 });
      }

      console.log(`[stream-end] Atomic settled session ${sessionId}. Elapsed: ${elapsedSeconds}s, billed: ${actualCost}s, neverConnected: ${neverConnected}. Result:`, settleResult);
    }

    return NextResponse.json({ success: true, message: "Session ended successfully." });
  } catch (err) {
    return apiError(err, "Failed to end stream session.", 500);
  }
}
