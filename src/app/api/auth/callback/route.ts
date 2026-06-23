// ============================================================================
// DiipMynd — Backend: OAuth Callback Route
// GET /api/auth/callback
//
// This endpoint acts as a redirect bridge. It forwards the OAuth redirect parameters
// (code, state, errors, etc.) back to the client-side homepage, allowing the
// browser-based Supabase client to complete the PKCE token exchange using its
// locally stored code verifier.
// ============================================================================

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    
    // Redirect to home page, preserving all search parameters (query string).
    // The browser will automatically preserve any hash fragments (#) during redirect.
    // This allows the client-side Supabase SDK to handle the code/token exchange.
    const redirectUrl = new URL("/", request.url);
    redirectUrl.search = requestUrl.search;
    
    return NextResponse.redirect(redirectUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "OAuth callback crashed";
    console.error("[auth-callback] Callback execution error:", msg);
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(msg)}`, request.url)
    );
  }
}

