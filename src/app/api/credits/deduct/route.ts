// ============================================================================
// DiipMynd — Credit Deduction API
// POST /api/credits/deduct
//
// Authenticates user, checks credit balance, and atomically deducts cost
// for generation. Admins are billed 0 credits.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { adjustCredits, InsufficientCreditsError, UserNotFoundError } from "@/lib/credits";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // 2. Parse body parameters
    const body = await request.json().catch(() => ({}));
    const { amount, description, modelEndpoint, taskType } = body;

    let deductionAmount = 0;

    if (modelEndpoint) {
      const { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS } = await import("@/lib/packages");
      const ALL_MODELS = [...IMAGE_MODELS, ...VIDEO_MODELS, ...AUDIO_MODELS];
      const model = ALL_MODELS.find((m) => m.endpoint === modelEndpoint);
      if (!model) {
        return NextResponse.json({ error: "Unknown model endpoint." }, { status: 400 });
      }
      deductionAmount = model.creditCost;
    } else if (taskType) {
      const TASK_COSTS: Record<string, number> = {
        "whisper_transcription": 2,
      };
      if (!TASK_COSTS[taskType]) {
        return NextResponse.json({ error: "Unknown task type." }, { status: 400 });
      }
      deductionAmount = TASK_COSTS[taskType];
    } else if (currentUser.isAdmin && typeof amount === "number") {
      // Allow arbitrary amounts only for admins
      deductionAmount = amount;
    } else {
      return NextResponse.json(
        { error: "Invalid deduction request. Provide modelEndpoint or taskType." },
        { status: 400 }
      );
    }

    if (deductionAmount <= 0) {
      return NextResponse.json(
        { error: "Deduction amount must be greater than zero." },
        { status: 400 }
      );
    }

    // 3. Admin check (bypass billing)
    if (currentUser.isAdmin) {
      return NextResponse.json({
        success: true,
        credits: currentUser.credits,
        message: "Admin billing exemption.",
      });
    }

    // 4. Atomically deduct credits
    const newCredits = await adjustCredits(currentUser.id, -deductionAmount, `Media Generation (${modelEndpoint})`, "deduct-api");

    console.log(
      `[deduct-credits] User ${currentUser.email} billed ${deductionAmount} credits. Remaining: ${newCredits}. Reason: ${
        description || "Generation task"
      }`
    );

    return NextResponse.json({
      success: true,
      credits: newCredits,
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        {
          error: "Insufficient credits.",
          required: err.required,
          available: err.available,
        },
        { status: 402 }
      );
    }

    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    const msg = err instanceof Error ? err.message : "Failed to process credit deduction.";
    console.error("[deduct-credits] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
