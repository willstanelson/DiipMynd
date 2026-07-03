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

    // 2. Fetch reservation
    let reservation: any = null;
    const { data: dbReservation, error: resErr } = await supabaseAdmin
      .from("credit_reservations")
      .select("id, amount_reserved")
      .eq("reference_type", "stream")
      .eq("reference_id", sessionId)
      .eq("status", "reserved")
      .maybeSingle();

    if (resErr) {
      if (
        resErr.message.includes("permission denied") ||
        resErr.message.includes("does not exist") ||
        resErr.message.includes("relation")
      ) {
        if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_MOCK_ESCROW !== "true") {
          throw new Error("CRITICAL: credit_reservations table not found or read denied. Simulated escrow fallback is disabled in non-development environments.");
        }
        console.warn("[stream-end] credit_reservations table read denied or missing. Checking simulated local reservations.");
        const { findMockReservationByReference } = require("@/lib/credits");
        reservation = findMockReservationByReference("stream", sessionId);
      } else {
        return NextResponse.json({ error: "Failed to fetch reservation." }, { status: 500 });
      }
    } else {
      reservation = dbReservation;
    }

    // 3. Mark session as ended
    try {
      await supabaseAdmin
        .from("stream_sessions")
        .update({ status: "ended" })
        .eq("id", sessionId);
    } catch (e: any) {
      console.warn("[stream-end] stream_sessions status update skipped/failed:", e.message || e);
    }

    // 4. Settle reservation
    if (reservation) {
      const now = new Date();
      const startedAt = new Date(session.started_at);
      const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
      const actualCost = Math.min(reservation.amount_reserved, elapsedSeconds);

      await settleReservationEscrow(reservation.id, actualCost, "success");
      console.log(`[stream-end] Settled session ${sessionId}. Duration: ${actualCost}s. Refunded: ${reservation.amount_reserved - actualCost} credits.`);
    }

    return NextResponse.json({ success: true, message: "Session ended successfully." });
  } catch (err) {
    return apiError(err, "Failed to end stream session.", 500);
  }
}
