import { NextResponse } from "next/server";
import { supabase, supabaseAdmin } from "@/lib/supabase";
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

    // Verify if user is suspended
    if (data.user.app_metadata?.is_suspended === true) {
      return NextResponse.json(
        { error: "Your account has been suspended for violating our terms of service." },
        { status: 403 }
      );
    }

    // Fetch user profile details from the profiles table
    let { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits, is_admin, created_at")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[login] Failed to retrieve user profile from Supabase:", profileError.message);
      return NextResponse.json({ error: "Failed to load user profile details." }, { status: 500 });
    }

    if (!profile) {
      console.log(`[login] Profile not found for user ${data.user.id}, creating a default profile...`);
      const isAdmin = trimmedEmail === "willstanelson@gmail.com";
      const { data: newProfile, error: createProfileError } = await supabaseAdmin
        .from("profiles")
        .insert({
          id: data.user.id,
          email: trimmedEmail,
          credits: 100, // default credits
          is_admin: isAdmin,
        })
        .select("credits, is_admin, created_at")
        .single();

      if (createProfileError || !newProfile) {
        console.error("[login] Failed to create user profile in Supabase:", createProfileError);
        return NextResponse.json({ error: "Failed to load user profile details." }, { status: 500 });
      }
      profile = newProfile;
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
