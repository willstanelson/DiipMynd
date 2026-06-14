// ============================================================================
// DiipMynd — Backend: Secure Token Generation
// POST /api/decart-auth
//
// This route mints a short-lived Decart client token so the raw API key
// never leaves the server. The frontend uses this ephemeral token to
// initialize its WebRTC session.
// ============================================================================

import { NextResponse } from "next/server";
import { createDecartClient } from "@decartai/sdk";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/decart-auth
 *
 * 1. Authenticates request and checks credit balance.
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
        { error: "Unauthorized. Please log in first." },
        { status: 401 }
      );
    }

    // ── Guard: Verify credits (Admins bypass) ────────────────────────────
    if (!currentUser.isAdmin && currentUser.credits <= 0) {
      return NextResponse.json(
        { error: "Insufficient credits. Please fund your account." },
        { status: 403 }
      );
    }

    // ── Guard: ensure the API key is configured ──────────────────────────
    const apiKey = process.env.DECART_API_KEY;
    if (!apiKey) {
      console.error("[decart-auth] DECART_API_KEY is not set in environment.");
      return NextResponse.json(
        { error: "Server misconfiguration: missing API key." },
        { status: 500 }
      );
    }

    // ── Initialize the Decart client with the permanent server-side key ──
    const client = createDecartClient({ apiKey });

    // ── Mint a short-lived client token ──────────────────────────────────
    // - expiresIn: 300 seconds (5 minutes) — long enough for session setup,
    //   short enough to limit exposure if intercepted.
    // - allowedModels: restrict to "lucy-latest" to prevent misuse.
    const token = await client.tokens.create({
      expiresIn: 300,
      allowedModels: ["lucy-2.1"],
    });

    // ── Return the ephemeral token to the frontend ───────────────────────
    return NextResponse.json({
      apiKey: token.apiKey,
      expiresAt: token.expiresAt,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error during token creation.";
    console.error("[decart-auth] Token creation failed:", message);

    return NextResponse.json(
      { error: `Token creation failed: ${message}` },
      { status: 500 }
    );
  }
}
