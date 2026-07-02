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
 * Atomically reserves (deducts) credits only if the balance is sufficient.
 *
 * Unlike adjustCredits (which throws on insufficient funds but otherwise deducts
 * unconditionally), this returns `{ ok: false }` when the balance is too low,
 * without throwing — intended for the "reserve before queuing" pattern.
 *
 * Fixes audit finding H3: a naive `if (credits >= cost)` check followed by an
 * async queue insert is a TOCTOU race — many concurrent requests all pass the
 * check, then all execute and overdraw. This helper performs a single atomic
 * conditional deduction at the database.
 *
 * @returns `{ ok: true, balance }` on success, or `{ ok: false }` if insufficient.
 */
export async function reserveCredits(
  userId: string,
  amount: number,
  reason?: string,
  source?: string
): Promise<{ ok: true; balance: number } | { ok: false; available: number }> {
  if (amount <= 0) {
    throw new Error("reserveCredits: amount must be greater than zero.");
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("adjust_credits", {
      p_user_id: userId,
      p_delta: -amount,
      p_reason: reason,
      p_source: source,
    });

    if (error) {
      const msg = error.message || "";
      if (msg.includes("Insufficient credits")) {
        const match = msg.match(/have (\d+)/);
        return { ok: false, available: match ? parseInt(match[1], 10) : 0 };
      }
      throw new Error(`Credit reservation failed: ${msg}`);
    }

    const balance = Array.isArray(data) ? data[0]?.new_balance : data;
    if (typeof balance !== "number") {
      throw new Error("Unexpected RPC response format for reserveCredits.");
    }
    return { ok: true, balance };
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return { ok: false, available: err.available };
    }
    throw err;
  }
}

export interface EscrowReservationResult {
  ok: boolean;
  code: string;
  reservationId?: string;
  available?: number;
  newBalance?: number;
  status?: string;
}

export interface EscrowSettlementResult {
  ok: boolean;
  code: string;
  refunded?: number;
  status?: string;
}

/**
 * Atomically creates a credit reservation escrow hold for a user.
 */
import crypto from "crypto";

interface MockReservation {
  id: string;
  userId: string;
  amount: number;
  referenceType: string;
  referenceId: string;
  status: 'reserved' | 'committed' | 'released' | 'expired';
  expiresAt: Date;
}

const globalForMock = globalThis as unknown as {
  mockReservations?: Map<string, MockReservation>;
  mockActiveStreams?: Set<string>;
  pendingLocks?: Set<string>;
};

const mockReservations = (globalForMock.mockReservations ??= new Map<string, MockReservation>());
const mockActiveStreams = (globalForMock.mockActiveStreams ??= new Set<string>());
const pendingLocks = (globalForMock.pendingLocks ??= new Set<string>());

export function addMockStreamSession(userId: string) {
  mockActiveStreams.add(userId);
}

export function removeMockStreamSession(userId: string) {
  mockActiveStreams.delete(userId);
}

export function hasMockStreamSession(userId: string): boolean {
  return mockActiveStreams.has(userId);
}

export function findMockReservationByReference(referenceType: string, referenceId: string): { id: string; amount_reserved: number } | null {
  for (const res of mockReservations.values()) {
    if (res.referenceType === referenceType && res.referenceId === referenceId && res.status === 'reserved') {
      return { id: res.id, amount_reserved: res.amount };
    }
  }
  return null;
}

export function getExpiredMockReservations(): { id: string; amount_reserved: number }[] {
  const expired: { id: string; amount_reserved: number }[] = [];
  const now = new Date();
  for (const res of mockReservations.values()) {
    if (res.status === 'reserved' && res.expiresAt < now) {
      expired.push({ id: res.id, amount_reserved: res.amount });
    }
  }
  return expired;
}

function checkFallbackAllowed(action: string, details?: string) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_MOCK_ESCROW !== "true") {
    throw new Error(`CRITICAL: Database RPC or table not found during '${action}'. In-memory simulated escrow fallback is disabled in non-development environments.${details ? ' Details: ' + details : ''}`);
  }
}

/**
 * Atomically creates a credit reservation escrow hold for a user.
 */
export async function reserveCreditsEscrow(
  userId: string,
  amount: number,
  referenceType: 'job' | 'stream' | 'proxy_call',
  referenceId: string,
  ttlSeconds: number
): Promise<EscrowReservationResult> {
  if (amount <= 0) {
    throw new Error("reserveCreditsEscrow: amount must be greater than zero.");
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("reserve_credits", {
      p_user_id: userId,
      p_amount: amount,
      p_reference_type: referenceType,
      p_reference_id: referenceId,
      p_ttl_seconds: ttlSeconds,
    });

    if (error) {
      if (
        error.message.includes("reserve_credits") ||
        error.message.includes("does not exist") ||
        error.code === "PGRST202"
      ) {
        checkFallbackAllowed("reserveCreditsEscrow", error.message);
        console.warn("[credits] ⚠ RPC 'reserve_credits' not found. Falling back to simulated local escrow hold.");
        return await reserveCreditsEscrowFallback(userId, amount, referenceType, referenceId, ttlSeconds);
      }
      throw new Error(`RPC reserve_credits failed: ${error.message}`);
    }

    const result = Array.isArray(data) ? data[0] : data;
    return {
      ok: !!result?.ok,
      code: result?.code || "unknown",
      reservationId: result?.reservation_id,
      available: result?.available,
      newBalance: result?.new_balance,
      status: result?.status,
    };
  } catch (err: any) {
    console.error("[credits] reserveCreditsEscrow failed:", err.message || err);
    throw err;
  }
}

/**
 * Atomically settles (commits or releases) an active credit reservation.
 */
export async function settleReservationEscrow(
  reservationId: string,
  actualCost: number,
  outcome: 'success' | 'failure' | 'expired'
): Promise<EscrowSettlementResult> {
  if (reservationId.startsWith("mock-")) {
    checkFallbackAllowed("settleReservationEscrow", "mock- prefix in settle call");
    return await settleReservationEscrowFallback(reservationId, actualCost, outcome);
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("settle_reservation", {
      p_reservation_id: reservationId,
      p_actual_cost: actualCost,
      p_outcome: outcome,
    });

    if (error) {
      if (
        error.message.includes("settle_reservation") ||
        error.message.includes("does not exist") ||
        error.code === "PGRST202"
      ) {
        checkFallbackAllowed("settleReservationEscrow", error.message);
        console.warn("[credits] ⚠ RPC 'settle_reservation' not found. Falling back to simulated local escrow settlement.");
        return await settleReservationEscrowFallback(reservationId, actualCost, outcome);
      }
      throw new Error(`RPC settle_reservation failed: ${error.message}`);
    }

    const result = Array.isArray(data) ? data[0] : data;
    return {
      ok: !!result?.ok,
      code: result?.code || "unknown",
      refunded: result?.refunded,
      status: result?.status,
    };
  } catch (err: any) {
    console.error("[credits] settleReservationEscrow failed:", err.message || err);
    throw err;
  }
}

async function reserveCreditsEscrowFallback(
  userId: string,
  amount: number,
  referenceType: string,
  referenceId: string,
  ttlSeconds: number
): Promise<EscrowReservationResult> {
  const lockKey = `${referenceType}:${referenceId}`;
  if (pendingLocks.has(lockKey)) {
    // Mimic database serialization failure / block duplicate concurrent inserts
    return { ok: false, code: "race_condition_locked", available: 0 };
  }
  pendingLocks.add(lockKey);

  try {
    // Idempotency: Check if active reservation already exists
    for (const res of mockReservations.values()) {
      if (res.referenceType === referenceType && res.referenceId === referenceId && res.status === 'reserved') {
        return { ok: true, code: "already_reserved", reservationId: res.id, status: "reserved" };
      }
    }

    // 1. Fetch user profile
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (error || !profile) {
      return { ok: false, code: "user_not_found", available: 0 };
    }

    // 2. Verify balance
    if (profile.credits < amount) {
      return { ok: false, code: "insufficient_credits", available: profile.credits };
    }

    // 3. Deduct balance from profile
    const newBalance = profile.credits - amount;
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ credits: newBalance })
      .eq("id", userId);

    if (updateError) {
      throw new Error(`Fallback reserve hold failed: ${updateError.message}`);
    }

    // 4. Create mock reservation
    const reservationId = `mock-${crypto.randomUUID()}`;
    mockReservations.set(reservationId, {
      id: reservationId,
      userId,
      amount,
      referenceType,
      referenceId,
      status: 'reserved',
      expiresAt: new Date(Date.now() + ttlSeconds * 1000)
    });

    return {
      ok: true,
      code: "reserved",
      reservationId,
      newBalance,
      status: "reserved"
    };
  } finally {
    pendingLocks.delete(lockKey);
  }
}

async function settleReservationEscrowFallback(
  reservationId: string,
  actualCost: number,
  outcome: 'success' | 'failure' | 'expired'
): Promise<EscrowSettlementResult> {
  const res = mockReservations.get(reservationId);
  if (!res) {
    // If not found in memory, we assume a graceful success return
    return { ok: false, code: "reservation_not_found" };
  }

  if (res.status !== 'reserved') {
    return { ok: true, code: "already_settled", status: res.status };
  }

  // 1. Load user profile
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("credits")
    .eq("id", res.userId)
    .single();

  if (error || !profile) {
    return { ok: false, code: "user_not_found" };
  }

  let refunded = 0;
  if (outcome === 'success') {
    refunded = res.amount - actualCost;
    res.status = 'committed';
  } else {
    refunded = res.amount;
    res.status = outcome === 'expired' ? 'expired' : 'released';
  }

  if (refunded > 0) {
    const newBalance = profile.credits + refunded;
    await supabaseAdmin
      .from("profiles")
      .update({ credits: newBalance })
      .eq("id", res.userId);
  }

  return {
    ok: true,
    code: res.status === 'committed' ? 'committed' : 'released',
    refunded,
    status: res.status
  };
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
  checkFallbackAllowed("adjustCreditsFallback", "RPC function adjust_credits not found or failed");

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
