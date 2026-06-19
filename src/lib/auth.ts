import { cookies } from "next/headers";
import { supabase, supabaseAdmin } from "./supabase";

export interface SafeUser {
  id: string;
  email: string;
  credits: number;
  isAdmin: boolean;
  createdAt: string;
  isSuspended?: boolean;
}

/**
 * Gets the current logged-in user from the active HTTP-only session cookie.
 * Returns null if the user is not authenticated or the session has expired.
 */
export async function getCurrentUser(): Promise<SafeUser | null> {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("session_id")?.value;
    if (!accessToken) {
      return null;
    }

    // Authenticate the token with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (error || !user) {
      return null;
    }

    // Secure check: check if the user is suspended
    if (user.app_metadata?.is_suspended === true) {
      console.warn(`[auth] Access denied for suspended user: ${user.id}`);
      return null;
    }

    // Fetch profile details (credits, isAdmin) from the profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits, is_admin, created_at")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[auth] Failed to retrieve user profile from Supabase:", profileError);
      return null;
    }

    return {
      id: user.id,
      email: user.email!,
      credits: profile.credits,
      isAdmin: profile.is_admin,
      createdAt: profile.created_at,
    };
  } catch (err) {
    console.error("[auth] Failed to retrieve current user:", err);
    return null;
  }
}

/**
 * Sets a secure, HTTP-only session cookie for the client.
 */
export async function setSessionCookie(accessToken: string, expiresAt: number): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("session_id", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

/**
 * Clears the session cookie to log the user out.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("session_id");
}
