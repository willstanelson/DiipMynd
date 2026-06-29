// ============================================================================
// DiipMynd — Atomic Credit Operations
//
// Provides a single atomic function for all credit adjustments. Uses a
// Supabase RPC function (`adjust_credits`) that acquires a row-level lock
// (SELECT ... FOR UPDATE) before modifying the balance, preventing race
// conditions under concurrent requests.
//
// If the RPC function has not been deployed yet, falls back to a sequential
// read-then-write with a logged warning. The RPC approach is required for
// production — see supabase/migrations/001_adjust_credits_function.sql.
// ============================================================================

import { supabaseAdmin } from "./supabase/server";

export class InsufficientCreditsError extends Error {
  public readonly available: number;
  public readonly required: number;

  constructor(available: number, required: number) {
    super(`Insufficient credits: have ${available}, need ${required}`);
    this.name = "InsufficientCreditsError";
    this.available = available;
    this.required = required;
  }
}

export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User profile not found: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

/**
 * Atomically adjusts a user's credit balance.
 *
 * @param userId - The user's UUID
 * @param delta  - Amount to add (positive) or deduct (negative)
 * @returns The new credit balance after adjustment
 *
 * @throws InsufficientCreditsError if deducting more than available
 * @throws UserNotFoundError if the user profile doesn't exist
 * @throws Error for other database failures
 */
export async function adjustCredits(
  userId: string, 
  delta: number, 
  reason?: string, 
  source?: string, 
  adminId?: string
): Promise<number> {
  // ── Primary: Use atomic RPC function ───────────────────────────────────
  try {
    const { data, error } = await supabaseAdmin.rpc("adjust_credits", {
      p_user_id: userId,
      p_delta: delta,
      p_reason: reason,
      p_source: source,
      p_admin_id: adminId,
    });

    if (error) {
      const msg = error.message || "";

      // The RPC function raises specific exceptions we can parse
      if (msg.includes("Insufficient credits")) {
        // Extract numbers from "Insufficient credits: have X, need Y"
        const match = msg.match(/have (\d+), need (\d+)/);
        const available = match ? parseInt(match[1], 10) : 0;
        const required = match ? parseInt(match[2], 10) : Math.abs(delta);
        throw new InsufficientCreditsError(available, required);
      }

      if (msg.includes("User profile not found")) {
        throw new UserNotFoundError(userId);
      }

      // If the function doesn't exist yet, fall through to fallback
      if (
        msg.includes("Could not find the function") ||
        msg.includes("function adjust_credits") ||
        error.code === "PGRST202"
      ) {
        console.warn(
          "[credits] ⚠ RPC function 'adjust_credits' not found. " +
          "Run supabase/migrations/001_adjust_credits_function.sql to enable atomic operations. " +
          "Falling back to non-atomic read-then-write."
        );
        return await adjustCreditsFallback(userId, delta, reason, source, adminId);
      }

      throw new Error(`Credit adjustment failed: ${msg}`);
    }

    // RPC returns an array of { new_balance } rows; take the first
    const newBalance = Array.isArray(data) ? data[0]?.new_balance : data;

    if (typeof newBalance !== "number") {
      throw new Error("Unexpected RPC response format for adjust_credits.");
    }

    return newBalance;
  } catch (err) {
    // Re-throw our typed errors
    if (err instanceof InsufficientCreditsError || err instanceof UserNotFoundError) {
      throw err;
    }

    // For unexpected errors, check if it's a "function not found" and fallback
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("Could not find the function") || errMsg.includes("PGRST202")) {
      console.warn("[credits] ⚠ Falling back to non-atomic credit adjustment.");
      return await adjustCreditsFallback(userId, delta, reason, source, adminId);
    }

    throw err;
  }
}

/**
 * Non-atomic fallback for when the RPC function hasn't been deployed.
 * This is NOT safe under concurrent load — it exists only as a development
 * convenience. Deploy the SQL migration for production use.
 */
async function adjustCreditsFallback(
  userId: string, 
  delta: number,
  reason?: string,
  source?: string,
  adminId?: string
): Promise<number> {
  // 1. Read current balance
  const { data: profile, error: selectError } = await supabaseAdmin
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  if (selectError || !profile) {
    throw new UserNotFoundError(userId);
  }

  // 2. Validate for deductions
  if (delta < 0 && profile.credits < Math.abs(delta)) {
    throw new InsufficientCreditsError(profile.credits, Math.abs(delta));
  }

  // 3. Compute and write
  const newCredits = Math.max(0, profile.credits + delta);

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ credits: newCredits })
    .eq("id", userId);

  if (updateError) {
    throw new Error(`Failed to update credit balance: ${updateError.message}`);
  }

  // Always log fallback adjustments, even if reason/source are missing
  await supabaseAdmin.from("credit_ledger").insert({
    user_id: userId,
    delta,
    reason: reason ? `[FALLBACK] ${reason}` : "[FALLBACK] Manual Adjustment",
    source: source || "fallback",
    admin_id: adminId || null,
  });

  return newCredits;
}
