// ============================================================================
// DiipMynd — Worker: Reconcile Reservations Cron
// POST /api/worker/reconcile-reservations  (CRON_SECRET protected)
//
// Finds orphaned credit reservations (status = 'reserved' and expires_at < NOW())
// and releases them (outcomes = 'expired', restoring user balances).
// ============================================================================

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { settleReservationEscrow } from "@/lib/credits";
import { apiError, requireCronAuth } from "@/lib/api";

export const maxDuration = 300;

export async function POST() {
  const authFail = await requireCronAuth();
  if (authFail) return authFail;

  try {
    let expiredList: { id: string; amount_reserved: number }[] = [];
    const { data, error: fetchError } = await supabaseAdmin
      .from("credit_reservations")
      .select("id, amount_reserved")
      .eq("status", "reserved")
      .lt("expires_at", new Date().toISOString())
      .limit(100);

    if (fetchError) {
      if (
        fetchError.message.includes("does not exist") ||
        fetchError.code === "PGRST202" ||
        fetchError.code === "PGRST205" ||
        fetchError.code === "PGRST116" ||
        fetchError.message.includes("relation")
      ) {
        if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_MOCK_ESCROW !== "true") {
          throw new Error("CRITICAL: credit_reservations table not found. Simulated escrow fallback is disabled in non-development environments.");
        }
        console.warn("[reconcile-reservations] credit_reservations table not found. Using simulated local reservations sweep.");
        const { getExpiredMockReservations } = require("@/lib/credits");
        expiredList = getExpiredMockReservations();
      } else {
        console.error("[reconcile-reservations] Fetch error:", fetchError);
        return NextResponse.json({ error: "Failed to fetch expired reservations." }, { status: 500 });
      }
    } else {
      expiredList = data || [];
    }

    if (!expiredList || expiredList.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: "No expired reservations." });
    }

    let processed = 0;
    let failed = 0;

    for (const res of expiredList) {
      try {
        const settleResult = await settleReservationEscrow(res.id, res.amount_reserved, "expired");
        if (settleResult.ok) {
          processed++;
        } else {
          console.error(`[reconcile-reservations] Settle failed for ${res.id}:`, settleResult.code);
          failed++;
        }
      } catch (settleErr: any) {
        console.error(`[reconcile-reservations] Exception settling ${res.id}:`, settleErr.message || settleErr);
        failed++;
      }
    }

    console.log(`[reconcile-reservations] Processed: ${processed}, Failed: ${failed}, Total: ${expiredList.length}`);

    return NextResponse.json({
      success: true,
      processed,
      failed,
      total: expiredList.length,
    });
  } catch (err) {
    return apiError(err, "Failed to run reservations reconciliation tick.", 500);
  }
}
