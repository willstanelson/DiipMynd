// ============================================================================
// DiipMynd — Database-Backed Rate Limiter
//
// Limits client requests based on IP address or User ID using a Supabase
// table (`rate_limits`). Safe for serverless environments (e.g., Vercel Edge).
// ============================================================================

import { supabaseAdmin } from "./supabase/server";

/**
 * Enforces rate limiting on a given key using a fixed window algorithm.
 *
 * @param key       - Unique identifier (e.g., "runway_user_123" or "runway_ip_1.2.3.4")
 * @param maxTokens - Maximum allowed requests within the window
 * @param windowMs  - Duration in milliseconds of the rolling window
 * @param options.failOpen - When false (default), the limiter DENIES on DB error.
 *                    Set true only for best-effort, non-security limits. Fixes
 *                    audit finding H5: security-sensitive limits must fail closed.
 * @returns boolean - true if the request is rate-limited, false if allowed
 */
export async function checkRateLimit(
  key: string,
  maxTokens: number,
  windowMs: number,
  options: { failOpen?: boolean } = {}
): Promise<boolean> {
  const { failOpen = false } = options;
  try {
    const { data, error } = await supabaseAdmin.rpc("increment_rate_limit", {
      p_key: key,
      p_window_ms: windowMs,
    });

    if (error) {
      console.error("[rate-limit] DB error:", error.message);
      // Fail CLOSED for security limits (default). Only fail open for explicitly
      // best-effort callers — i.e. when the cost of a false positive (blocking
      // a legit user under DB pressure) outweighs the security cost.
      return !failOpen;
    }

    const currentCount = data || 0;

    // Rate limit if the current count exceeds max allowed
    return currentCount > maxTokens;
  } catch (err) {
    console.error("[rate-limit] Exception:", err);
    return !failOpen;
  }
}
