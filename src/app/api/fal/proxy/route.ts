// ============================================================================
// DiipMynd — Fal.ai Secure Server Proxy Route
//
// Wraps `@fal-ai/server-proxy` handler with an authentication check to prevent
// unauthorized API consumption. Only authenticated users are allowed to proxy
// requests through the server. Specifies the allowlisted endpoints to prevent
// arbitrary model executions.
// ============================================================================

import { createRouteHandler } from "@fal-ai/server-proxy/nextjs";
import { getCurrentUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

const { GET: falGET, POST: falPOST, PUT: falPUT } = createRouteHandler({
  // Only allow proxying calls to models used in the workstation
  allowedEndpoints: [
    "fal-ai/flux/schnell",
    "fal-ai/flux/dev",
    "fal-ai/flux/pro",
    "fal-ai/flux-realism",
    "fal-ai/recraft-v3",
    "fal-ai/playground-v25",
    "fal-ai/stable-diffusion-v3-medium",
    "fal-ai/nano-banana-pro",
    "openai/gpt-image-2",
    "fal-ai/kling-video/v1.5/pro",
    "fal-ai/kling-video/v3/pro/text-to-video",
    "fal-ai/luma-dream-machine",
    "fal-ai/hunyuan-video",
    "fal-ai/veo3.1",
    "fal-ai/sora-2/text-to-video/pro",
    "fal-ai/mochi-1",
    "fal-ai/pika/v2.1/text-to-video",
    "fal-ai/cogvideox-5b",
    "fal-ai/kokoro",
    "fal-ai/f5-tts",
    "fal-ai/xtts-v2",
    "fal-ai/elevenlabs/tts",
    "fal-ai/heygen/avatar-v/digital-twin",
    "fal-ai/sync-lipsync/v2/pro",
    "fal-ai/whisper",
    "decart/lucy2-vton/realtime",
  ],
});

/**
 * Common middleware-like wrapper to authenticate the incoming proxy request.
 */
async function authenticateProxy(
  request: NextRequest,
  handler: (req: NextRequest) => Promise<Response> | Response
): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    if (await checkRateLimit(`fal_proxy_${user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "Rate limit exceeded. Please try again later." }, { status: 429 });
    }
    return await handler(request);
  } catch (err: any) {
    console.error("[fal-proxy] Auth verification failed:", err.message || err);
    return NextResponse.json({ error: "Proxy authentication verification failed." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return authenticateProxy(request, falGET);
}

export async function POST(request: NextRequest) {
  return authenticateProxy(request, falPOST);
}

export async function PUT(request: NextRequest) {
  return authenticateProxy(request, falPUT);
}
