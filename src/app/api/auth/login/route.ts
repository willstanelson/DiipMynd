import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate inputs
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Call Supabase sign in
    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error || !data.user || !data.session) {
      return NextResponse.json({ error: error?.message || "Invalid email or password." }, { status: 401 });
    }

    // Fetch user profile details from the profiles table
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits, is_admin, created_at")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      console.error("[login] Failed to retrieve user profile from Supabase:", profileError);
      return NextResponse.json({ error: "Failed to load user profile details." }, { status: 500 });
    }

    // Set HTTP-only session cookie
    const expiresAt = Date.now() + data.session.expires_in * 1000;
    await setSessionCookie(data.session.access_token, expiresAt);

    // Return safe user information (excluding credentials)
    const safeUser = {
      id: data.user.id,
      email: data.user.email!,
      credits: profile.credits,
      isAdmin: profile.is_admin,
      createdAt: profile.created_at,
    };

    return NextResponse.json({ success: true, user: safeUser });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Authentication failed";
    console.error("[login] Error authenticating user:", msg);
    return NextResponse.json({ error: `Authentication failed: ${msg}` }, { status: 500 });
  }
}
