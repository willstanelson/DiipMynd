import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { clearSessionCookie } from "@/lib/auth";

export async function POST() {
  try {
    // Clear session on Supabase
    await supabase.auth.signOut();

    // Always clear the cookie
    await clearSessionCookie();

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Logout failed";
    console.error("[logout] Error during logout:", msg);
    return NextResponse.json({ error: `Logout failed: ${msg}` }, { status: 500 });
  }
}
