// ============================================================================
// DiipMynd — Backend: OAuth Callback Route
// GET /api/auth/callback
//
// This endpoint receives the authorization code from Supabase Auth after a
// successful OAuth login (Google/Apple), exchanges it for a user session,
// sets the secure HTTP-only cookie, and redirects the user back to the homepage.
// ============================================================================

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { setSessionCookie } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get("code");

    if (code) {
      // Exchange the code for a Supabase session
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      
      if (error) {
        console.error("[auth-callback] Failed to exchange code for session:", error.message);
        return NextResponse.redirect(new URL("/?auth_error=oauth_failed", request.url));
      }

      if (data.session) {
        // Compute absolute expiry time
        const expiresAt = Date.now() + data.session.expires_in * 1000;
        
        // Save the access token to our secure HttpOnly cookie
        await setSessionCookie(data.session.access_token, expiresAt);
        
        // Success: redirect back to home page
        return NextResponse.redirect(new URL("/", request.url));
      }
    }

    // Default redirect to home page in case code is missing or exchange failed
    return NextResponse.redirect(new URL("/?auth_error=no_session", request.url));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "OAuth callback crashed";
    console.error("[auth-callback] Callback execution error:", msg);
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(msg)}`, request.url)
    );
  }
}
