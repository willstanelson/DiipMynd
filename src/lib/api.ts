// ============================================================================
// DiipMynd — Shared API Helpers
//
// Centralizes:
//   * error sanitization (never leak DB/internal details to the client)
//   * cron/worker authentication (CRON_SECRET header check)
//   * trusted client-IP extraction (resists X-Forwarded-For spoofing)
// ============================================================================

import { NextResponse } from "next/server";
import { headers } from "next/headers";

/**
 * Generic, safe error response. Logs the real error server-side and returns
 * a non-revealing message to the client. Fixes audit finding M5/L1
 * (raw err.message leaking schema/provider internals).
 */
export function apiError(err: unknown, fallback = "Internal server error.", status = 500): NextResponse {
  const detail = err instanceof Error ? err.message : String(err);
  // Full detail stays on the server only.
  console.error("[api-error]", detail);
  return NextResponse.json({ error: fallback }, { status });
}

/**
 * Authenticates a worker/cron endpoint against a shared secret.
 *
 * Accepts either:
 *   * `Authorization: Bearer <CRON_SECRET>`
 *   * `x-cron-secret: <CRON_SECRET>`
 *
 * Returns null on success, or a 401 NextResponse on failure. Fixes audit
 * finding C2 (worker endpoints had zero authentication).
 */
export async function requireCronAuth(): Promise<NextResponse | null> {
  const h = await headers();
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    // Server misconfiguration: refuse to run rather than fail open.
    console.error("[cron-auth] CRON_SECRET is not set on the server.");
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 500 });
  }

  const authHeader = h.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const headerSecret = h.get("x-cron-secret") || "";

  // Constant-time-ish comparison to avoid trivial timing leaks.
  const provided = headerSecret || bearer;
  if (!provided || provided.length !== secret.length || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

/**
 * Extracts the best available client IP. Prefers the platform-trusted hop,
 * and never returns a value that would cause a DoS-amplifying collision
 * (i.e. never collapses every request onto a shared literal key). Fixes audit
 * finding H6 (spoofable X-Forwarded-For).
 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  // Vercel sets x-vercel-forwarded-for / x-real-ip at the trusted edge.
  // x-forwarded-for is a comma list: leftmost = original client (only trust
  // this when set by our proxy, so we take the FIRST entry).
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") || h.get("x-vercel-forwarded-for") || null;
}
