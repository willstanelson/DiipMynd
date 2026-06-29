import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { adjustCredits } from "@/lib/credits";
import { fal } from "@fal-ai/client";
import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS } from "@/lib/packages";

export const maxDuration = 300; // Allow edge function to run up to 5 minutes

export async function POST(request: Request) {
  try {
    // 1. Claim up to 3 jobs from the queue atomically
    const { data: jobs, error: claimError } = await supabaseAdmin.rpc("claim_generation_jobs", {
      max_jobs: 3,
      target_type: null // Claim all jobs (video or image)
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
        try {
          const { payload, user_id } = job;
          const { model, prompt, ...falInput } = payload;

          const modelDef = ALL_MODELS.find((m) => m.endpoint === model);
          if (!modelDef) throw new Error("Unknown model in payload.");

          let generatedUrl = "";

          // Simulate processing
          if (model === "runway-gen4.5") {
             // Example runway handler via your /api/runway logic
             throw new Error("Runway integration must be handled server-side here.");
          } else {
             // Execute fal job
             const result: any = await fal.run(model, { input: { prompt, ...falInput } });
             if (job.type === "image") {
               generatedUrl = result?.images?.[0]?.url || result?.url;
             } else {
               generatedUrl = result?.video?.url || result?.videos?.[0]?.url || result?.url;
             }
          }

          if (!generatedUrl) {
            throw new Error("Provider returned no video URL.");
          }

          // In production, we'd fetch this URL and upload to our own Supabase Storage bucket 
          // to persist it and grab the persistentUrl. For this demonstration, we use the raw URL.
          const persistentUrl = generatedUrl;

          // Deduct credits ONLY on successful generation
          await adjustCredits(user_id, -modelDef.creditCost, `Generation Job: ${modelDef.endpoint}`, "queue-worker");

          // Update library_assets (simplified)
          await supabaseAdmin.from("library_assets").insert({
            user_id,
            type: job.type,
            name: `${job.type.toUpperCase()}: ${prompt?.substring(0, 24)}...`,
            url: persistentUrl,
            model,
            prompt,
          });

          // Mark job completed
          await supabaseAdmin
            .from("generation_jobs")
            .update({ status: "completed", result_url: persistentUrl })
            .eq("id", job.id);

          return { id: job.id, status: "completed" };
        } catch (err: any) {
          console.error(`[process-queue] Job ${job.id} failed:`, err);
          
          await supabaseAdmin
            .from("generation_jobs")
            .update({ 
              status: "pending", 
              payload: { ...job.payload, error: err.message } 
              // The next_eligible_at was already set by the claim logic if retries incremented
            })
            .eq("id", job.id);
            
          throw err;
        }
      })
    );

    const processedCount = results.filter((r) => r.status === "fulfilled").length;
    
    // Reap any stuck processing jobs before exiting
    await supabaseAdmin.rpc("reap_stale_jobs", { timeout_minutes: 5 });

    return NextResponse.json({
      success: true,
      processed: processedCount,
      totalClaimed: jobs.length,
    });
  } catch (err: any) {
    console.error("[process-queue] Fatal error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
