import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { apiError } from "@/lib/api";

export async function POST() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // Modest rate limit: 1 keepalive / 5s per user (cheap DB writes, but unbounded).
    const limited = await checkRateLimit(`keepalive_${currentUser.id}`, 1, 5 * 1000, {
      failOpen: true, // best-effort — don't kill a live stream on a DB blip
    });
    if (limited) {
      return NextResponse.json(
        { error: "Keep-alive rate limit exceeded." },
        { status: 429 }
      );
    }

    // .maybeSingle() is safe if zero or one row matches; .single() would 500
    // if the user somehow has >1 active session. Fixes L7.
    const { data, error } = await supabaseAdmin
      .from("stream_sessions")
      .update({ last_keepalive_at: new Date().toISOString() })
      .eq("user_id", currentUser.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();

    if (error || !data) {
      // The session is no longer active (ended by billing worker on timeout / 0 credits).
      return NextResponse.json({ error: "Session is gone or ended." }, { status: 410 });
    }

    // Check associated reservation hold (if not admin)
    if (!currentUser.isAdmin) {
      const { data: reservation } = await supabaseAdmin
        .from("credit_reservations")
        .select("status")
        .eq("reference_type", "stream")
        .eq("reference_id", data.id)
        .maybeSingle();

      if (reservation && reservation.status !== "reserved") {
        // Force-end the session row since hold has been released or expired
        await supabaseAdmin
          .from("stream_sessions")
          .update({ status: "ended" })
          .eq("id", data.id);
        
        return NextResponse.json({ error: "Session credit hold expired or released." }, { status: 410 });
      }
    }

    return NextResponse.json({ success: true, message: "Keep-alive registered." });
  } catch (err) {
    return apiError(err, "Failed to register keep-alive.", 500);
  }
}
