import { NextResponse } from "next/server";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate request inputs
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail.includes("@")) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long." }, { status: 400 });
    }

    // Call Supabase signup
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
    });

    if (error || !data.user) {
      return NextResponse.json({ error: error?.message || "Registration failed." }, { status: 400 });
    }

    // Provision admin role if email matches willstanelson@gmail.com
    const isAdmin = trimmedEmail === "willstanelson@gmail.com";
    if (isAdmin) {
      const { error: profileUpdateError } = await supabaseAdmin
        .from("profiles")
        .update({ is_admin: true })
        .eq("id", data.user.id);
      
      if (profileUpdateError) {
        console.error("[signup] Failed to set admin flag in profiles:", profileUpdateError.message);
      }
    }

    // Check if session was auto-created (e.g. if email confirmation is disabled)
    if (data.session) {
      const expiresAt = Date.now() + data.session.expires_in * 1000;
      await setSessionCookie(data.session.access_token, expiresAt);

      const safeUser = {
        id: data.user.id,
        email: data.user.email!,
        credits: 100,
        isAdmin,
        createdAt: data.user.created_at,
      };

      return NextResponse.json({ success: true, user: safeUser });
    }

    // If email confirmation is enabled, session is null, we return the user with a message
    return NextResponse.json({
      success: true,
      message: "Registration successful. Please check your email to verify your account.",
      user: {
        id: data.user.id,
        email: data.user.email!,
        credits: 100,
        isAdmin,
        createdAt: data.user.created_at,
      }
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Registration failed";
    console.error("[signup] Error registering user:", msg);
    return NextResponse.json({ error: `Registration failed: ${msg}` }, { status: 500 });
  }
}
