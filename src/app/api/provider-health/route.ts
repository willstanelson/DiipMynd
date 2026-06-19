// ============================================================================
// DiipMynd — Provider Health Check Endpoint
// GET /api/provider-health
//
// Performs a quick availability + latency check against both Decart and Fal.ai
// backend APIs. The Smart Router on the client uses this to decide which
// provider to route the streaming session to.
// ============================================================================

import { NextResponse } from "next/server";
import type { ProviderHealthResponse, ProviderHealthStatus } from "@/types";

/**
 * Ping a URL and return latency in ms, or mark as unavailable on failure.
 */
async function probeEndpoint(
  url: string,
  init?: RequestInit,
  checkFn?: (res: Response) => boolean
): Promise<ProviderHealthStatus> {
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s hard cap

    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Math.round(performance.now() - start);
    const available = checkFn ? checkFn(res) : res.ok;
    return { available, latencyMs };
  } catch {
    return { available: false, latencyMs: -1 };
  }
}

export async function GET() {
  // Probe both providers concurrently
  const [decart, fal] = await Promise.all([
    // Decart — client tokens endpoint GET (returns 405 Method Not Allowed when active)
    probeEndpoint(
      "https://api.decart.ai/v1/client/tokens",
      {
        method: "GET",
      },
      (res) => res.ok || res.status === 405
    ).catch(() => ({ available: false, latencyMs: -1 } as ProviderHealthStatus)),

    // Fal.ai — probe the main website/CDN endpoint
    probeEndpoint("https://fal.ai", {
      method: "GET",
    }).catch(() => ({ available: false, latencyMs: -1 } as ProviderHealthStatus)),
  ]);

  const result: ProviderHealthResponse = { decart, fal };
  return NextResponse.json(result);
}
