// ============================================================================
// DiipMynd — Worker: Stream Billing
// POST /api/worker/billing  (CRON_SECRET protected)
//
// Auth: requires a valid CRON_SECRET header.
//
// Hardening vs. original (audit findings C2 / M1):
//   * CRON_SECRET auth gate.
//   * `maxDuration` declared (matches the other workers).
//   * Per-tick deduction is CAPPED — a slow tick can no longer dock a user
//     hundreds of credits in one shot.
//   * Uses the real RPC (`adjust_credits`) — the original referenced
//     `adjust_user_credits_atomic`, which does not exist.
//   * Sessions are processed in a bounded batch; staleness and zero-balance are
//     terminal (status = 'ended') and recorded.
// ============================================================================

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { apiError, requireCronAuth } from "@/lib/api";

export const maxDuration = 300;

const BILL_INTERVAL_SECONDS = 30; // only bill at least this much elapsed
const MAX_DEDUCT_PER_TICK = 60; // hard ceiling per tick — prevents runaway drains
const STALE_AFTER_SECONDS = 90; // end sessions with no recent keepalive

export async function POST() {
  const authFail = await requireCronAuth();
  if (authFail) return authFail;

  try {
    // 1. Fetch a bounded batch of active sessions.
    const { data: sessions, error: fetchError } = await supabaseAdmin
      .from("stream_sessions")
      .select("id, user_id, provider, started_at, last_billed_at, last_keepalive_at")
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
      const lastBilled = new Date(session.last_billed_at);
      const lastKeepalive = new Date(session.last_keepalive_at);

      const secondsSinceBilled = (now.getTime() - lastBilled.getTime()) / 1000;
      const secondsSinceKeepalive = (now.getTime() - lastKeepalive.getTime()) / 1000;

      // Staleness timeout — terminal.
      if (secondsSinceKeepalive > STALE_AFTER_SECONDS) {
        await supabaseAdmin.from("stream_sessions").update({ status: "ended" }).eq("id", session.id);
        ended++;
        continue;
      }

      // Only bill when a full interval has elapsed.
      if (secondsSinceBilled >= BILL_INTERVAL_SECONDS) {
        // 1 credit/sec, CAPPED so a slow tick can't drain a balance.
        const costToDeduct = Math.min(MAX_DEDUCT_PER_TICK, Math.floor(secondsSinceBilled));

        const { data: updatedProfile, error: deductError } = await supabaseAdmin.rpc("adjust_credits", {
          p_user_id: session.user_id,
          p_delta: -costToDeduct,
          p_reason: "Stream billing tick",
          p_source: "worker-billing",
        });

        if (deductError) {
          console.error(`[worker/billing] Deduction failed for ${session.user_id}:`, deductError);
          await supabaseAdmin.from("stream_sessions").update({ status: "ended" }).eq("id", session.id);
          ended++;
          continue;
        }

        const remainingCredits = Array.isArray(updatedProfile)
          ? updatedProfile?.[0]?.new_balance ?? 0
          : updatedProfile ?? 0;

        if (remainingCredits <= 0) {
          await supabaseAdmin.from("stream_sessions").update({ status: "ended" }).eq("id", session.id);
          ended++;
        } else {
          await supabaseAdmin
            .from("stream_sessions")
            .update({ last_billed_at: now.toISOString() })
            .eq("id", session.id);
          processed++;
        }
      }
    }

    return NextResponse.json({ success: true, processed, ended });
  } catch (err) {
    return apiError(err, "Failed to run billing tick.", 500);
  }
}
