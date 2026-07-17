// ============================================================================
// DiipMynd — Stream API: Signal Connection & Rebase Billing Escalation Hold
// POST /api/stream/connect
//
// Invoked when the WebRTC stream transitions to connected status. Rebases the
// session started_at and reservation expires_at from the exact moment of connection,
// making setup latency completely free for the streaming user.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
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

    // 1. Fetch the session to verify user ownership
    const { data: session, error: fetchErr } = await supabaseAdmin
      .from("stream_sessions")
      .select("user_id, status")
      .eq("id", sessionId)
      .maybeSingle();

    if (fetchErr || !session) {
      console.error("[stream-connect] Failed to find session:", fetchErr?.message);
      return NextResponse.json({ error: "Stream session not found." }, { status: 404 });
    }

    if (session.user_id !== currentUser.id) {
      return NextResponse.json({ error: "Unauthorized access to session." }, { status: 403 });
    }

    if (session.status !== "active") {
      return NextResponse.json({ error: "Session is not active." }, { status: 400 });
    }

    // 2. Call the atomic RPC to set connected_at and extend the reservation hold
    const { data: connectResult, error: connectErr } = await supabaseAdmin.rpc("connect_stream_session", {
      p_session_id: sessionId
    });

    if (connectErr) {
      console.error("[stream-connect] Failed to connect session via RPC:", connectErr.message);
      return NextResponse.json({ error: "Failed to establish connection timing on server." }, { status: 500 });
    }

    if (!connectResult || connectResult.ok === false) {
      console.error("[stream-connect] connect_stream_session RPC returned failure code:", connectResult?.code);
      return NextResponse.json({ error: connectResult?.code || "Failed to establish connection timing." }, { status: 500 });
    }

    console.log(`[stream-connect] Successfully connected session ${sessionId}. RPC response:`, connectResult);

    // Convert PgTimestamp string to unix epoch milliseconds if available
    let reservationExpiresAt: number | null = null;
    if (connectResult.expires_at) {
      reservationExpiresAt = new Date(connectResult.expires_at).getTime();
    }

    return NextResponse.json({
      success: true,
      code: connectResult.code,
      reservationExpiresAt
    });
  } catch (err) {
    return apiError(err, "Failed to connect stream session.", 500);
  }
}
