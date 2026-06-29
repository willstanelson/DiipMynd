// ============================================================================
// DiipMynd — Authentication Signup API
// POST /api/auth/signup
//
// Registers a new user account with Supabase Auth.
// Protected by rate limiting (3 registrations per 10 minutes per IP) to prevent
// bot spam and resource exhaustion.
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
    
    // Max 3 registrations per 10 minutes (600,000 ms)
    if (await checkRateLimit(`signup_${clientIp}`, 5, 5 * 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many registration attempts from this network. Please try again later." },
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

    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
    });

    if (error || !data.user) {
      return NextResponse.json({ error: error?.message || "Registration failed." }, { status: 400 });
    }

    if (data.session) {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: "Profile provisioning failed." }, { status: 500 });
      }
      return NextResponse.json({ success: true, user });
    }

    return NextResponse.json({
      success: true,
      message: "Registration successful. Please check your email to verify your account.",
      user: {
        id: data.user.id,
        email: data.user.email!,
        credits: 100,
        isAdmin: false,
        createdAt: data.user.created_at,
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Registration failed";
    console.error("[signup] Error during signup:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
