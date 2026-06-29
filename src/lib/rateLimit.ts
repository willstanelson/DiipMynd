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
 * @returns boolean - true if the request is rate-limited, false if allowed
 */
export async function checkRateLimit(key: string, maxTokens: number, windowMs: number): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc("increment_rate_limit", {
      p_key: key,
      p_window_ms: windowMs,
    });

    if (error) {
      console.error("[rate-limit] DB error:", error.message);
      return false; // Fail open to not block legit traffic if DB is slow
    }

    const currentCount = data || 0;
    
    // Rate limit if the current count exceeds max allowed
    return currentCount > maxTokens;
  } catch (err) {
    console.error("[rate-limit] Exception:", err);
    return false; // Fail open
  }
}
