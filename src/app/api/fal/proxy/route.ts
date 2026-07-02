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
import { supabaseAdmin } from "@/lib/supabase/server";
import { reserveCreditsEscrow, settleReservationEscrow } from "@/lib/credits";
import { IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS } from "@/lib/packages";
import crypto from "crypto";

const { GET: falGET, POST: falPOST, PUT: falPUT } = createRouteHandler({
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

function parseModelEndpoint(targetUrl: string): string | null {
  try {
    const url = new URL(targetUrl);
    let path = url.pathname;
    if (path.startsWith("/")) {
      path = path.slice(1);
    }
    return path;
  } catch (e) {
    return null;
  }
}

function getModelCreditCost(endpoint: string): number {
  const ALL_MODELS = [...IMAGE_MODELS, ...VIDEO_MODELS, ...AUDIO_MODELS];
  const matched = ALL_MODELS.find((m) => m.endpoint === endpoint);
  if (matched) {
    return matched.creditCost;
  }

  const fallbackCosts: Record<string, number> = {
    "fal-ai/whisper": 2,
    "fal-ai/flux/schnell": 5,
    "fal-ai/flux/dev": 8,
    "fal-ai/flux-realism": 10,
    "fal-ai/stable-diffusion-v3-medium": 5,
    "fal-ai/kling-video/v1.5/pro": 30,
    "fal-ai/luma-dream-machine": 30,
    "fal-ai/hunyuan-video": 25,
    "fal-ai/mochi-1": 25,
    "fal-ai/cogvideox-5b": 25,
  };

  return fallbackCosts[endpoint] || 10;
}

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
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // 1. General Rate Limit
    if (await checkRateLimit(`fal_proxy_${user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "Rate limit exceeded. Please try again later." }, { status: 429 });
    }

    // 2. Spend-velocity Circuit Breaker
    if (!user.isAdmin) {
      if (await checkRateLimit(`fal_proxy_velocity_${user.id}`, 15, 60 * 1000)) {
        return NextResponse.json({ 
          error: "Spend velocity limit exceeded. Circuit breaker triggered." 
        }, { status: 429 });
      }
    }

    const targetUrl = request.headers.get("x-fal-target-url") || "";
    const endpoint = parseModelEndpoint(targetUrl);

    if (!endpoint) {
      return NextResponse.json({ error: "Missing or invalid target model url." }, { status: 400 });
    }

    // 3. Handle Streaming session verification
    if (endpoint === "decart/lucy2-vton/realtime") {
      if (!user.isAdmin) {
        const { data: activeSession, error: sessionErr } = await supabaseAdmin
          .from("stream_sessions")
          .select("id")
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle();

        let hasActive = false;
        if (sessionErr) {
          if (
            sessionErr.message.includes("permission denied") ||
            sessionErr.message.includes("does not exist") ||
            sessionErr.message.includes("relation")
          ) {
            if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_MOCK_ESCROW !== "true") {
              throw new Error("CRITICAL: stream_sessions table not found or read denied. Simulated escrow fallback is disabled in non-development environments.");
            }
            console.warn("[fal-proxy] stream_sessions table read denied or missing. Checking simulated local session.");
            const { hasMockStreamSession } = require("@/lib/credits");
            hasActive = hasMockStreamSession(user.id);
          } else {
            return NextResponse.json({ error: "Database error verifying stream session." }, { status: 500 });
          }
        } else {
          hasActive = !!activeSession;
        }

        if (!hasActive) {
          return NextResponse.json({ 
            error: "No active stream session. Call /api/stream/start first." 
          }, { status: 402 });
        }
      }
      return await falPOST(request);
    }

    // 4. Handle Standard generation cost reservation
    if (user.isAdmin) {
      return await falPOST(request);
    }

    const cost = getModelCreditCost(endpoint);
    const requestId = crypto.randomUUID();

    // Escrow Reservation
    const reservation = await reserveCreditsEscrow(user.id, cost, "proxy_call", requestId, 120);
    if (!reservation.ok) {
      return NextResponse.json({
        error: "Insufficient credits to process request.",
        required: cost,
        available: reservation.available ?? 0
      }, { status: 402 });
    }

    const reservationId = reservation.reservationId!;
    let response: Response;
    let outcome: "success" | "failure" = "success";

    try {
      const mockHeader = request.headers.get("x-test-mock");
      if (process.env.NODE_ENV !== "production" && mockHeader === "success") {
        response = new Response(JSON.stringify({ success: true }), { status: 200 });
      } else if (process.env.NODE_ENV !== "production" && mockHeader === "failure") {
        response = new Response(JSON.stringify({ error: "Mock failure" }), { status: 500 });
        outcome = "failure";
      } else {
        response = await falPOST(request);
        if (!response.ok) {
          outcome = "failure";
        }
      }
    } catch (err) {
      outcome = "failure";
      throw err;
    } finally {
      try {
        await settleReservationEscrow(reservationId, cost, outcome);
      } catch (settleErr) {
        console.error(`[fal-proxy] Failed to settle reservation ${reservationId}:`, settleErr);
      }
    }

    return response;
  } catch (err: any) {
    console.error("[fal-proxy] POST request failed:", err.message || err);
    return NextResponse.json({ error: "Failed to process proxy request." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  return authenticateProxy(request, falPUT);
}
