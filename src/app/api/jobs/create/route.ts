// ============================================================================
// DiipMynd — Job Queue: Create Generation Job
// POST /api/jobs/create
//
// Hardening vs. original (audit findings H3 / H6 / M5):
//   * Credits are ATOMICALLY RESERVED at queue time (not just checked). The old
//     `if (credits >= cost)` followed by an async insert was a TOCTOU race that
//     let concurrent requests overdraw. Reservation is a single conditional
//     deduction at the DB.
//   * On success, the queue worker consumes the reservation; on failure it
//     refunds (see worker/process-queue).
//   * Trusted IP for rate limiting; sanitized errors.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { VIDEO_MODELS, IMAGE_MODELS, AUDIO_MODELS } from "@/lib/packages";
import { checkRateLimit } from "@/lib/rateLimit";
import { reserveCreditsEscrow, settleReservationEscrow } from "@/lib/credits";
import { apiError, getClientIp } from "@/lib/api";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { type, payload } = body;

    if (!type || !payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Missing type or payload." }, { status: 400 });
    }

    // Rate Limit Check (trusted IP).
    const ip = await getClientIp();
    const ipKey = ip ? `jobs_ip_${ip}` : "jobs_ip_anon";
    const userLimited = await checkRateLimit(`jobs_user_${currentUser.id}`, 20, 60 * 1000);
    const ipLimited = await checkRateLimit(ipKey, 100, 60 * 1000);

    if (userLimited || ipLimited) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later." },
        { status: 429 }
      );
    }

    // Determine cost from a recognized model.
    let requiredCredits = 0;
    const modelPool =
      type === "video" ? VIDEO_MODELS : type === "image" ? IMAGE_MODELS : type === "audio" ? AUDIO_MODELS : null;

    if (!modelPool || !payload.model) {
      return NextResponse.json({ error: "Unsupported job type." }, { status: 400 });
    }
    const model = modelPool.find((m) => m.endpoint === payload.model);
    if (!model) {
      return NextResponse.json({ error: "Unknown model." }, { status: 400 });
    }
    requiredCredits = model.creditCost;

    const jobId = crypto.randomUUID();

    // Atomically reserve credits BEFORE queueing. This closes the TOCTOU window:
    // concurrent requests can't all pass a read-only check and then overdraw.
    // (Admins are exempt.)
    let reservationId: string | null = null;
    if (!currentUser.isAdmin) {
      const reservation = await reserveCreditsEscrow(
        currentUser.id,
        requiredCredits,
        "job",
        jobId,
        1800 // 30 minutes TTL
      );
      if (!reservation.ok) {
        return NextResponse.json(
          {
            error: "Insufficient credits to start this generation job.",
            required: requiredCredits,
            available: reservation.available,
          },
          { status: 402 }
        );
      }
      reservationId = reservation.reservationId || null;
    }

    // Insert job into generation_jobs with explicit jobId
    const { data: job, error } = await supabaseAdmin
      .from("generation_jobs")
      .insert({
        id: jobId,
        user_id: currentUser.id,
        type,
        payload,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      // Queueing failed → refund the reservation we just made immediately.
      if (reservationId) {
        try {
          await settleReservationEscrow(reservationId, requiredCredits, "failure");
        } catch (refundErr) {
          console.error(`[api/jobs/create] REFUND FAILED for ${currentUser.id}:`, refundErr);
        }
      }
      console.error("[api/jobs/create] DB Insert Error:", error.message);
      return NextResponse.json({ error: "Failed to queue generation job." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
    });
  } catch (err) {
    return apiError(err, "Failed to create job.", 500);
  }
}
