// ============================================================================
// DiipMynd — Admin Sessions Monitor API
// GET /api/admin/sessions
//
// Admin-auth-gated real-time view of every active stream session, with the
// derived billing-health fields needed to spot the Bug #1 failure state
// (a session that has run past its reservation window). No new tables —
// reuses stream_sessions, credit_reservations (joined by the same explicit
// query pattern established in the settlement paths, not a nested embed),
// and profiles.
//
// No pagination for v1: a large active-session count is itself the signal
// something is wrong, so capping at a generous limit is fine.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

const MAX_SESSIONS = 500;

interface ActiveSessionRow {
  id: string;
  user_id: string;
  provider: string;
  started_at: string;
  connected_at: string | null;
  last_keepalive_at: string;
}

interface ReservationRow {
  reference_id: string;
  amount_reserved: number;
  expires_at: string;
}

export async function GET() {
  try {
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    // 1. Fetch all active sessions.
    const { data: sessions, error } = await supabaseAdmin
      .from("stream_sessions")
      .select("id, user_id, provider, started_at, connected_at, last_keepalive_at")
      .eq("status", "active")
      .limit(MAX_SESSIONS);

    if (error) {
      console.error("[admin-sessions] Failed to fetch active sessions:", error.message);
      return NextResponse.json({ error: "Failed to fetch active sessions." }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ success: true, sessions: [] });
    }

    // 2. Fetch the reservations for these sessions explicitly — no FK exists
    // between credit_reservations and stream_sessions (reference_id is a TEXT
    // column matched by convention), so this is a separate query, not a nested
    // embed. Same pattern as the settlement clamp fixes (Bug #1).
    const sessionIds = sessions.map((s) => s.id);
    const { data: reservations, error: resErr } = await supabaseAdmin
      .from("credit_reservations")
      .select("reference_id, amount_reserved, expires_at")
      .eq("reference_type", "stream")
      .in("reference_id", sessionIds)
      .eq("status", "reserved");

    if (resErr) {
      console.error("[admin-sessions] Failed to fetch reservations:", resErr.message);
      // Don't 500 — the sessions view is still useful without reservation data.
    }

    const reservationBySessionId = new Map<string, ReservationRow>();
    for (const r of reservations || []) {
      reservationBySessionId.set(r.reference_id, r as ReservationRow);
    }

    // 3. Fetch user emails for these sessions.
    const userIds = [...new Set(sessions.map((s) => s.user_id))];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, email, is_admin")
      .in("id", userIds);

    const emailByUserId = new Map<string, string>();
    const adminFlagByUserId = new Map<string, boolean>();
    for (const p of profiles || []) {
      emailByUserId.set(p.id, p.email || "");
      adminFlagByUserId.set(p.id, !!p.is_admin);
    }

    // 4. Build the view rows and sort overdue / soonest-expiring first.
    const now = Date.now();

    const rows = sessions.map((s: ActiveSessionRow) => {
      const startTime = s.connected_at ? new Date(s.connected_at).getTime() : new Date(s.started_at).getTime();
      const elapsedSeconds = Math.max(0, Math.floor((now - startTime) / 1000));
      const reservation = reservationBySessionId.get(s.id);

      const amountReserved = reservation?.amount_reserved ?? null;
      const reservationExpiresAt = reservation?.expires_at ?? null;
      const isAdmin = !!adminFlagByUserId.get(s.user_id);

      // Flag exactly the Bug #1 failure state: a session billed past its
      // reservation window. Admin sessions have no reservation, so never
      // overdue on this axis.
      const isOverdue = !isAdmin && amountReserved !== null && elapsedSeconds > amountReserved;

      const secondsUntilExpiry = reservationExpiresAt
        ? Math.floor((new Date(reservationExpiresAt).getTime() - now) / 1000)
        : null;

      const lastKeepaliveMs = new Date(s.last_keepalive_at).getTime();
      const secondsSinceKeepalive = Math.max(0, Math.floor((now - lastKeepaliveMs) / 1000));

      return {
        id: s.id,
        userId: s.user_id,
        email: emailByUserId.get(s.user_id) || "(unknown)",
        isAdmin,
        provider: s.provider,
        startedAt: s.started_at,
        connectedAt: s.connected_at,
        lastKeepaliveAt: s.last_keepalive_at,
        elapsedSeconds,
        amountReserved,
        reservationExpiresAt,
        secondsUntilExpiry,
        isOverdue,
        secondsSinceKeepalive,
      };
    });

    // Sort: overdue first, then soonest-expiring, then longest-elapsed.
    rows.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      const aExpiry = a.secondsUntilExpiry ?? Number.MAX_SAFE_INTEGER;
      const bExpiry = b.secondsUntilExpiry ?? Number.MAX_SAFE_INTEGER;
      if (aExpiry !== bExpiry) return aExpiry - bExpiry;
      return b.elapsedSeconds - a.elapsedSeconds;
    });

    return NextResponse.json({ success: true, sessions: rows });
  } catch (err) {
    return apiError(err, "Failed to fetch active sessions.", 500);
  }
}
