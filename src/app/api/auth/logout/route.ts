import { NextResponse } from "next/server";
import { createClientWithCookies } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

export async function POST() {
  try {
    const supabase = await createClientWithCookies();
    await supabase.auth.signOut();
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, "Logout failed.", 500);
  }
}
