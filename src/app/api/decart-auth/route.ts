// ============================================================================
// DiipMynd — Backend: Secure Decart Token Generation
// POST /api/decart-auth
//
// This route mints a short-lived Decart client token so the raw API key
// never leaves the server. The frontend uses this ephemeral token to
// initialize its WebRTC session via the Decart SDK.
// ============================================================================

import { NextResponse } from "next/server";
import { createDecartClient } from "@decartai/sdk";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/decart-auth
 *
 * 1. Authenticates request via session cookie.
 * 2. Reads DECART_API_KEY from the server environment.
 * 3. Calls client.tokens.create() to mint a short-lived token (5 min TTL).
 * 4. Returns { apiKey, expiresAt } to the caller.
 */
export async function POST() {
  try {
    // ── Guard: Authenticate user ─────────────────────────────────────────
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    // ── Guard: Check credits (non-admin only) ────────────────────────────
    if (!currentUser.isAdmin && currentUser.credits <= 0) {
      return NextResponse.json(
        { error: "Insufficient credits. Please top up your account." },
        { status: 403 }
      );
    }

    // ── Mint ephemeral token ─────────────────────────────────────────────
    const apiKey = process.env.DECART_API_KEY;
    if (!apiKey) {
      console.error("[decart-auth] DECART_API_KEY is not set in environment.");
      return NextResponse.json(
        { error: "Decart API key is not configured on the server." },
        { status: 500 }
      );
    }

    const client = createDecartClient({ apiKey });

    const token = await client.tokens.create({
      expiresIn: 300, // 5 minutes TTL
      allowedModels: ["lucy-2.1"],
    });

    // Calculate the absolute expiry timestamp
    const expiresAt = Date.now() + 300 * 1000;

    return NextResponse.json({
      apiKey: token.apiKey,
      expiresAt,
    });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to generate Decart token.";
    console.error("[decart-auth] Token generation failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
