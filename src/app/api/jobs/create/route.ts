import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { VIDEO_MODELS, IMAGE_MODELS } from "@/lib/packages";
import { checkRateLimit } from "@/lib/rateLimit";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { type, payload } = body;

    if (!type || !payload) {
      return NextResponse.json({ error: "Missing type or payload." }, { status: 400 });
    }

    // Rate Limit Check
    const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown_ip";
    const userLimited = await checkRateLimit(`jobs_user_${currentUser.id}`, 20, 60 * 1000); // 20 per minute
    const ipLimited = await checkRateLimit(`jobs_ip_${ip}`, 100, 60 * 1000); // 100 per minute

    if (userLimited || ipLimited) {
      return NextResponse.json({ error: "Rate limit exceeded. Please try again later." }, { status: 429 });
    }

    // Determine cost to ensure user has enough credits
    let requiredCredits = 0;
    if (type === "video" && payload.model) {
      const model = VIDEO_MODELS.find((m) => m.endpoint === payload.model);
      if (!model) {
        return NextResponse.json({ error: "Unknown video model." }, { status: 400 });
      }
      requiredCredits = model.creditCost;
    } else if (type === "image" && payload.model) {
      const model = IMAGE_MODELS.find((m) => m.endpoint === payload.model);
      if (!model) {
        return NextResponse.json({ error: "Unknown image model." }, { status: 400 });
      }
      requiredCredits = model.creditCost;
    } else {
      return NextResponse.json({ error: "Unsupported job type." }, { status: 400 });
    }

    if (!currentUser.isAdmin && currentUser.credits < requiredCredits) {
      return NextResponse.json({
        error: "Insufficient credits to start this generation job.",
        required: requiredCredits,
        available: currentUser.credits,
      }, { status: 402 });
    }

    // Insert job into generation_jobs
    const { data: job, error } = await supabaseAdmin
      .from("generation_jobs")
      .insert({
        user_id: currentUser.id,
        type,
        payload,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      console.error("[api/jobs/create] DB Insert Error:", error);
      throw new Error("Failed to queue generation job.");
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
    });
  } catch (err: any) {
    console.error("[api/jobs/create] Exception:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
