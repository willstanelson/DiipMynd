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
      .select("id, started_at, status, user_id")
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

    // 2. Calculate actual cost based on elapsed seconds
    const now = new Date();
    const startedAt = new Date(session.started_at);
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));

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
      const { data: settleResult, error: settleErr } = await supabaseAdmin.rpc("settle_stream_session", {
        p_session_id: sessionId,
        p_actual_cost: elapsedSeconds,
        p_outcome: "success"
      });

      if (settleErr) {
        console.error(`[stream-end] Failed to settle session atomically:`, settleErr.message);
        return NextResponse.json({ error: "Failed to settle reservation hold." }, { status: 500 });
      }

      console.log(`[stream-end] Atomic settled session ${sessionId}. Elapsed: ${elapsedSeconds}s. Result:`, settleResult);
    }

    return NextResponse.json({ success: true, message: "Session ended successfully." });
  } catch (err) {
    return apiError(err, "Failed to end stream session.", 500);
  }
}
