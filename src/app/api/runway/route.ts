// ============================================================================
// DiipMynd — Runway ML API Integration Route
//
// Secure server-side endpoint wrapper for executing Runway Gen 4.5
// video generation tasks. Prevents exposed API keys.
//
// Hardening vs. original (audit findings H1 / H6 / M5 / L6):
//   * On FAILED / timeout / missing output, the 40 reserved credits are
//     REFUNDED — the user is never charged for a generation that didn't
//     produce a result.
//   * promptImage URL scheme is validated (https only) to reduce blind-SSRF.
//   * duration is clamped to Runway's allowed set.
//   * IP is taken from the trusted helper (no spoofable X-Forwarded-For).
//   * Errors sanitized.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import RunwayML from "@runwayml/sdk";
import { checkRateLimit } from "@/lib/rateLimit";
import { adjustCredits, InsufficientCreditsError } from "@/lib/credits";
import { apiError, getClientIp } from "@/lib/api";

const RUNWAY_COST = 40;
const ALLOWED_DURATIONS = new Set([5, 10]);
const ALLOWED_RATIOS = new Set(["1280:720", "720:1280", "16:9", "9:16", "1:1"]);

export async function POST(req: NextRequest) {
  // 1. Authenticate user
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: max 5 generations per 5 minutes per user, plus an IP tier.
  const ip = await getClientIp();
  const ipKey = ip ? `runway_ip_${ip}` : "runway_ip_anon";
  const userLimited = await checkRateLimit(`runway_user_${user.id}`, 5, 5 * 60 * 1000);
  const ipLimited = await checkRateLimit(ipKey, 20, 5 * 60 * 1000);

  if (userLimited || ipLimited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please try again later." },
      { status: 429 }
    );
  }

  // 2. Validate environment
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) {
    console.error("[runway-api] RUNWAY_API_KEY environment variable is not defined.");
    return NextResponse.json(
      { error: "Runway API integration is not configured." },
      { status: 500 }
    );
  }

  // 3. Parse and validate input params
  const body = await req.json().catch(() => ({}));
  const { promptText, promptImage, ratio, duration } = body;

  if (!promptText || typeof promptText !== "string" || !promptText.trim()) {
    return NextResponse.json(
      { error: "Missing required visual prompt description." },
      { status: 400 }
    );
  }

  // Validate promptImage scheme (https only) — reduces blind-SSRF via Runway.
  if (promptImage !== undefined && promptImage !== null) {
    if (typeof promptImage !== "string" || !/^https:\/\/[^\s]+$/i.test(promptImage)) {
      return NextResponse.json(
        { error: "promptImage must be an https:// URL." },
        { status: 400 }
      );
    }
  }

  const parsedDuration = ALLOWED_DURATIONS.has(parseInt(duration, 10))
    ? parseInt(duration, 10)
    : 5;
  const safeRatio = ALLOWED_RATIOS.has(ratio) ? ratio : "1280:720";

  // 4. Deduct credits BEFORE triggering generation (reserved).
  if (!user.isAdmin) {
    try {
      await adjustCredits(user.id, -RUNWAY_COST, "Runway Gen 4.5 Video Generation", "runway-api");
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: "Insufficient credits." }, { status: 402 });
      }
      throw err;
    }
  }

  // Whether we still owe the user a refund on failure. Admins never paid.
  const charged = !user.isAdmin;
  const refund = async () => {
    if (!charged) return;
    try {
      await adjustCredits(user.id, RUNWAY_COST, "Runway refund: failed/timeout", "runway-api-refund");
    } catch (refundErr) {
      console.error(`[runway-api] REFUND FAILED for user ${user.id}:`, refundErr);
    }
  };

  // 5. Initialize RunwayML Node SDK and launch task
  const client = new RunwayML({ apiKey });

  console.log(
    `[runway-api] Launching Runway generation for ${user.email}. Mode: ${promptImage ? "Image-to-Video" : "Text-to-Video"}`
  );

  try {
    let task;
    if (promptImage) {
      task = await client.imageToVideo.create({
        model: "gen4.5",
        promptImage,
        promptText: promptText.trim(),
        ratio: safeRatio,
        duration: parsedDuration,
      });
    } else {
      task = await client.textToVideo.create({
        model: "gen4.5",
        promptText: promptText.trim(),
        ratio: safeRatio,
        duration: parsedDuration,
      });
    }

    console.log(`[runway-api] Runway task created with ID: ${task.id}. Polling for output...`);

    // 6. Poll for task completion (5 min ceiling).
    let outputTask: any = { status: "PENDING" };
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max (5s poll intervals)

    while (
      outputTask.status !== "SUCCEEDED" &&
      outputTask.status !== "FAILED" &&
      attempts < maxAttempts
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      outputTask = await client.tasks.retrieve(task.id);
      attempts++;
      console.log(
        `[runway-api] Polling task ${task.id}: Status is ${outputTask.status} (attempt ${attempts})`
      );
    }

    if (outputTask.status === "FAILED") {
      await refund();
      return NextResponse.json(
        { error: "Runway generation task failed. Your credits have been refunded." },
        { status: 502 }
      );
    }

    if (outputTask.status !== "SUCCEEDED") {
      await refund();
      return NextResponse.json(
        { error: "Runway video generation timed out. Your credits have been refunded." },
        { status: 504 }
      );
    }

    const outputUrl = outputTask.output?.[0] || (outputTask as any).url;
    if (!outputUrl) {
      await refund();
      return NextResponse.json(
        { error: "Runway task succeeded but returned no output. Your credits have been refunded." },
        { status: 502 }
      );
    }

    console.log(`[runway-api] Runway generation succeeded! Output: ${outputUrl}`);
    return NextResponse.json({ url: outputUrl });
  } catch (err) {
    // Generation threw — refund the reserved credits.
    await refund();
    return apiError(err, "Runway video generation failed.", 502);
  }
}
