// ============================================================================
// DiipMynd — Runway ML API Integration Route
//
// Secure server-side endpoint wrapper for executing Runway Gen 4.5
// video generation tasks. Prevents exposed API keys.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import RunwayML from "@runwayml/sdk";
import { checkRateLimit } from "@/lib/rateLimit";
import { adjustCredits, InsufficientCreditsError } from "@/lib/credits";

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: max 5 generations per 5 minutes per user
    const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown_ip";
    const userLimited = await checkRateLimit(`runway_user_${user.id}`, 5, 5 * 60 * 1000);
    const ipLimited = await checkRateLimit(`runway_ip_${ip}`, 20, 5 * 60 * 1000);

    if (userLimited || ipLimited) {
      return NextResponse.json({ error: "Rate limit exceeded. Please try again later." }, { status: 429 });
    }

    // Deduct credits BEFORE triggering generation (Gen 4.5 costs 40 credits)
    if (!user.isAdmin) {
      try {
        await adjustCredits(user.id, -40, "Runway Gen 4.5 Video Generation", "runway-api");
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return NextResponse.json({ error: "Insufficient credits." }, { status: 402 });
        }
        throw err;
      }
    }

    // 2. Validate environment
    const apiKey = process.env.RUNWAY_API_KEY;
    if (!apiKey) {
      console.error("[runway-api] RUNWAY_API_KEY environment variable is not defined.");
      return NextResponse.json({ error: "Runway API integration is not configured." }, { status: 500 });
    }

    // 3. Parse and validate input params
    const body = await req.json();
    const { promptText, promptImage, ratio, duration } = body;

    if (!promptText || typeof promptText !== "string" || !promptText.trim()) {
      return NextResponse.json({ error: "Missing required visual prompt description." }, { status: 400 });
    }

    // 4. Initialize RunwayML Node SDK
    const client = new RunwayML({
      apiKey,
    });

    console.log(`[runway-api] Launching Runway generation. Mode: ${promptImage ? "Image-to-Video" : "Text-to-Video"}`);

    let task;
    if (promptImage) {
      task = await client.imageToVideo.create({
        model: "gen4.5",
        promptImage,
        promptText: promptText.trim(),
        ratio: ratio || "1280:720",
        duration: duration ? parseInt(duration) : 5,
      });
    } else {
      task = await client.textToVideo.create({
        model: "gen4.5",
        promptText: promptText.trim(),
        ratio: ratio || "1280:720",
        duration: duration ? parseInt(duration) : 5,
      });
    }

    console.log(`[runway-api] Runway task created with ID: ${task.id}. Polling for output...`);

    // 5. Poll for task completion manually
    let outputTask: any = { status: "PENDING" };

    // Await completion manually if waitForTaskOutput is not loaded or needs manual polling
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max (5s poll intervals)
    
    while (outputTask.status !== "SUCCEEDED" && outputTask.status !== "FAILED" && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      outputTask = await client.tasks.retrieve(task.id);
      attempts++;
      console.log(`[runway-api] Polling task ${task.id}: Status is ${outputTask.status} (attempt ${attempts})`);
    }

    if (outputTask.status === "FAILED") {
      const errorMsg = (outputTask as any).failure || "Runway generation task failed.";
      throw new Error(errorMsg);
    }

    if (outputTask.status !== "SUCCEEDED") {
      throw new Error("Runway video generation timed out on the server.");
    }

    const outputUrl = outputTask.output?.[0] || (outputTask as any).url;
    if (!outputUrl) {
      throw new Error("Runway task succeeded but returned no valid output URL.");
    }

    console.log(`[runway-api] Runway generation succeeded! Output: ${outputUrl}`);
    return NextResponse.json({ url: outputUrl });

  } catch (err: any) {
    console.error("[runway-api] Error during Runway generation:", err);
    return NextResponse.json({ error: err.message || "Runway video generation failed." }, { status: 500 });
  }
}
