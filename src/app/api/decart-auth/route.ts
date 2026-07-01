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
import { apiError } from "@/lib/api";

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

    // Defense in depth: never ship the master key to the browser. If the SDK
    // contract ever changed and tokens.create returned the master key, this
    // guard would catch it rather than silently leaking it. Fixes L5.
    const returnedKey = token?.apiKey;
    if (!returnedKey || returnedKey === apiKey) {
      console.error("[decart-auth] Token minting returned an unexpected key shape.");
      return NextResponse.json(
        { error: "Failed to generate a valid session token." },
        { status: 500 }
      );
    }

    // Calculate the absolute expiry timestamp
    const expiresAt = Date.now() + 300 * 1000;

    return NextResponse.json({
      apiKey: returnedKey,
      expiresAt,
    });
  } catch (err) {
    return apiError(err, "Failed to generate Decart token.", 500);
  }
}
