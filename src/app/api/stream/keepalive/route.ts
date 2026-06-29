import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("stream_sessions")
      .update({ last_keepalive_at: new Date().toISOString() })
      .eq("user_id", currentUser.id)
      .eq("status", "active")
      .select("id")
      .single();

    if (error || !data) {
      // The session is no longer active (e.g. ended by the billing worker due to timeout or 0 credits)
      return NextResponse.json({ error: "Session is gone or ended." }, { status: 410 });
    }

    return NextResponse.json({ success: true, message: "Keep-alive registered." });
  } catch (err: any) {
    console.error("[api/stream/keepalive] Exception:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
