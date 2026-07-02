// ============================================================================
// DiipMynd — Worker: Generation Queue Processor
// POST /api/worker/process-queue  (CRON_SECRET protected)
//
// Auth: requires a valid CRON_SECRET header (see lib/api.ts requireCronAuth).
//
// Hardening vs. original (audit findings C2 / H2):
//   * Deduct credits BEFORE the external paid call (prevents zero-balance users
//     from triggering paid generations).
//   * On failure, REFUND the reserved credits and transition the job to
//     `failed` once retries hit MAX_RETRIES — never silently re-pending into an
//     infinite paid loop.
//   * Library insert + status update happen after a successful generation; if
//     the insert fails, we refund rather than leaving the user charged.
// ============================================================================

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { settleReservationEscrow } from "@/lib/credits";
import { apiError, requireCronAuth } from "@/lib/api";
import { fal } from "@fal-ai/client";
import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS } from "@/lib/packages";

export const maxDuration = 300; // Allow the function to run up to 5 minutes

const MAX_RETRIES = 3;

export async function POST(request: Request) {
  // ── Auth: cron-only ───────────────────────────────────────────────────────
  const authFail = await requireCronAuth();
  if (authFail) return authFail;

  try {
    // 1. Claim up to 3 jobs from the queue atomically
    const { data: jobs, error: claimError } = await supabaseAdmin.rpc("claim_generation_jobs", {
      max_jobs: 3,
      target_type: null, // Claim all job types (image / video / audio)
    });

    if (claimError) {
      console.error("[process-queue] Failed to claim jobs:", claimError);
      return NextResponse.json({ error: "Failed to claim jobs" }, { status: 500 });
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: "Queue is empty." });
    }

    const ALL_MODELS = [...IMAGE_MODELS, ...VIDEO_MODELS, ...AUDIO_MODELS];

    // 2. Process jobs with Promise.allSettled to ensure isolation
    const results = await Promise.allSettled(
      jobs.map(async (job: any) => {
        const { payload, user_id } = job;
        const { model, prompt, ...falInput } = payload;

        const modelDef = ALL_MODELS.find((m) => m.endpoint === model);
        if (!modelDef) {
          await markFailed(job, "Unknown model in payload.", MAX_RETRIES);
          throw new Error("Unknown model in payload.");
        }

        // Fetch user profile to check admin status
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("is_admin")
          .eq("id", user_id)
          .maybeSingle();

        const isAdmin = !!profile?.is_admin;
        let reservation: any = null;

        // Verify credit reservation hold exists and is active (if not admin)
        if (!isAdmin) {
          const { data: resData, error: resError } = await supabaseAdmin
            .from("credit_reservations")
            .select("id, status")
            .eq("reference_type", "job")
            .eq("reference_id", job.id)
            .maybeSingle();

          if (resError || !resData) {
            await markFailed(job, "Missing credit reservation hold for job.", MAX_RETRIES);
            throw new Error("Missing credit reservation hold.");
          }

          if (resData.status !== "reserved") {
            await markFailed(job, "Reservation is already settled or expired.", MAX_RETRIES);
            throw new Error("Reservation already settled.");
          }
          reservation = resData;
        }

        try {
          let generatedUrl = "";

          if (model === "runway-gen4.5") {
            throw new Error("Runway integration must be handled via /api/runway, not the queue.");
          } else {
            const result: any = await fal.run(model, { input: { prompt, ...falInput } });
            if (job.type === "image") {
              generatedUrl = result?.images?.[0]?.url || result?.url;
            } else {
              generatedUrl = result?.video?.url || result?.videos?.[0]?.url || result?.url;
            }
          }

          if (!generatedUrl) {
            throw new Error("Provider returned no media URL.");
          }

          const persistentUrl = generatedUrl;

          // Persist asset. If this fails, refund the reservation rather than
          // leaving the user charged for a lost result.
          const { error: insertError } = await supabaseAdmin.from("library_assets").insert({
            user_id,
            type: job.type,
            name: `${job.type.toUpperCase()}: ${(prompt || "").substring(0, 24)}...`,
            url: persistentUrl,
            model,
            prompt,
          });

          if (insertError) {
            throw new Error(`Failed to persist generated asset: ${insertError.message}`);
          }

          // Mark job completed
          await supabaseAdmin
            .from("generation_jobs")
            .update({ status: "completed", result_url: persistentUrl })
            .eq("id", job.id);

          // Settle reservation hold successfully
          if (reservation) {
            await settleReservationEscrow(reservation.id, modelDef.creditCost, "success");
          }
          return { id: job.id, status: "completed" };
        } catch (genErr: any) {
          // Settle reservation hold to failure (fully refunding user)
          if (reservation) {
            try {
              await settleReservationEscrow(reservation.id, modelDef.creditCost, "failure");
            } catch (refundErr) {
              console.error(`[process-queue] Settle hold to failure FAILED for job ${job.id}:`, refundErr);
            }
          }
          await markFailed(job, genErr.message || "Generation failed.", MAX_RETRIES);
          throw genErr;
        }
      })
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - succeeded;

    // Reap any stuck processing jobs before exiting (crashed workers).
    await supabaseAdmin.rpc("reap_stale_jobs", { timeout_minutes: 5 });

    return NextResponse.json({
      success: true,
      processed: succeeded,
      failed,
      totalClaimed: jobs.length,
    });
  } catch (err) {
    return apiError(err, "Failed to process queue.", 500);
  }
}

/**
 * Transitions a job to either `pending` (still has retries) or `failed`
 * (terminal). Ensures no job loops forever as `pending` re-running a paid
 * external call on every tick. Fixes audit finding H2 (infinite paid retry).
 */
async function markFailed(job: any, reason: string, maxRetries: number) {
  const isTerminal = (job.retries || 0) + 1 >= maxRetries;
  await supabaseAdmin
    .from("generation_jobs")
    .update({
      status: isTerminal ? "failed" : "pending",
      payload: { ...job.payload, error: reason },
    })
    .eq("id", job.id);
}
