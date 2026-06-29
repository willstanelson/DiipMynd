// ============================================================================
// DiipMynd — Authentication Login API
// POST /api/auth/login
//
// Authenticates user via email and password using Supabase Auth.
// Protected by rate limiting (10 attempts per minute per IP) to prevent
// password brute-forcing.
// ============================================================================

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClientWithCookies } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

export async function POST(request: Request) {
  try {
    // ── Enforce Rate Limiting ─────────────────────────────────────────────
    const clientHeaders = await headers();
    const clientIp = clientHeaders.get("x-real-ip") || clientHeaders.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
    
    // Max 10 attempts per 60 seconds
    if (await checkRateLimit(`login_${clientIp}`, 10, 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again in a minute." },
        { status: 429 } // 429 Too Many Requests
      );
    }

    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const supabase = await createClientWithCookies();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error || !data.user || !data.session) {
      return NextResponse.json({ error: error?.message || "Invalid email or password." }, { status: 401 });
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication failed to load session." }, { status: 401 });
    }

    return NextResponse.json({ success: true, user });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Authentication failed";
    console.error("[login] Error during login:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
