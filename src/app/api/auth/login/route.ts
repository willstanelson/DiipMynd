// ============================================================================
// DiipMynd — Authentication Login API
// POST /api/auth/login
//
// Authenticates user via email and password using Supabase Auth.
// Protected by rate limiting (10 attempts per minute per IP) to prevent
// password brute-forcing.
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
    const ipKey = clientIp ? `login_${clientIp}` : "login_anon";

    // Fail-closed: brute-force protection must hold even under DB pressure.
    if (await checkRateLimit(ipKey, 10, 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again in a minute." },
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
  } catch (err) {
    return apiError(err, "Authentication failed.", 500);
  }
}
