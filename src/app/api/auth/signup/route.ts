// ============================================================================
// DiipMynd — Authentication Signup API
// POST /api/auth/signup
//
// Registers a new user account with Supabase Auth.
// Protected by rate limiting (3 registrations per 10 minutes per IP) to prevent
// bot spam and resource exhaustion.
// ============================================================================

import { NextResponse } from "next/server";
import { createClientWithCookies } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { apiError, getClientIp } from "@/lib/api";

export async function POST(request: Request) {
  try {
    // ── Enforce Rate Limiting ─────────────────────────────────────────────
    const clientIp = await getClientIp();
    const ipKey = clientIp ? `signup_${clientIp}` : "signup_anon";

    // Fail-closed (default): security-sensitive limit must NOT be bypassed on DB error.
    if (await checkRateLimit(ipKey, 5, 5 * 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many registration attempts from this network. Please try again later." },
        { status: 429 }
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
  } catch (err) {
    return apiError(err, "Registration failed.", 500);
  }
}
