import { NextResponse } from "next/server";
import { createClientWithCookies } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createClientWithCookies();
    await supabase.auth.signOut();
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Logout failed";
    console.error("[logout] Error during logout:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
