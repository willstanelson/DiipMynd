import { NextResponse } from "next/server";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { accessToken, expiresIn } = await request.json();

    if (!accessToken || !expiresIn) {
      return NextResponse.json({ error: "accessToken and expiresIn are required." }, { status: 400 });
    }

    // Authenticate the token with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (error || !user) {
      return NextResponse.json({ error: "Invalid access token." }, { status: 401 });
    }

    // Check if user is suspended
    if (user.app_metadata?.is_suspended === true) {
      return NextResponse.json(
        { error: "Your account has been suspended for violating our terms of service." },
        { status: 403 }
      );
    }

    // Fetch user profile details from the profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits, is_admin, created_at")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[auth-session] Failed to retrieve user profile from Supabase:", profileError);
      return NextResponse.json({ error: "Failed to load user profile details." }, { status: 500 });
    }

    // Set secure HttpOnly session cookie
    const expiresAt = Date.now() + expiresIn * 1000;
    await setSessionCookie(accessToken, expiresAt);

    const safeUser = {
      id: user.id,
      email: user.email!,
      credits: profile.credits,
      isAdmin: profile.is_admin,
      createdAt: profile.created_at,
    };

    return NextResponse.json({ success: true, user: safeUser });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Session setup failed";
    console.error("[auth-session] Error setting session:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
