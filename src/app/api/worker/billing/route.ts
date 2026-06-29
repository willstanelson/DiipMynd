import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST() {
  try {
    // 1. Fetch all active sessions
    const { data: sessions, error: fetchError } = await supabaseAdmin
      .from("stream_sessions")
      .select("id, user_id, provider, started_at, last_billed_at, last_keepalive_at")
      .eq("status", "active");

    if (fetchError) {
      console.error("[worker/billing] Failed to fetch active sessions:", fetchError);
      return NextResponse.json({ error: "Failed to fetch active sessions" }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: "No active sessions." });
    }

    const now = new Date();
    let processed = 0;

    for (const session of sessions) {
      const lastBilled = new Date(session.last_billed_at);
      const lastKeepalive = new Date(session.last_keepalive_at);
      
      const secondsSinceBilled = (now.getTime() - lastBilled.getTime()) / 1000;
      const secondsSinceKeepalive = (now.getTime() - lastKeepalive.getTime()) / 1000;

      // 90s staleness timeout
      if (secondsSinceKeepalive > 90) {
        await supabaseAdmin
          .from("stream_sessions")
          .update({ status: "ended" })
          .eq("id", session.id);
        console.log(`[worker/billing] Session ${session.id} ended due to staleness.`);
        continue;
      }

      // Deduct credits if 30s have passed since last billing (or whatever frequency)
      if (secondsSinceBilled >= 30) {
        // Calculate credits based on provider. Let's assume 1 credit per second for simplicity,
        // or a specific rate. We'll deduct 30 credits for 30 seconds.
        const costToDeduct = Math.floor(secondsSinceBilled * 1); // 1 credit/sec
        
        // Use RPC to atomically deduct
        const { data: updatedProfile, error: deductError } = await supabaseAdmin
          .rpc("adjust_user_credits_atomic", { 
            p_user_id: session.user_id, 
            p_amount: -costToDeduct 
          });

        if (deductError) {
          console.error(`[worker/billing] Failed to deduct credits for user ${session.user_id}:`, deductError);
          // End session if deduction fails critically
          await supabaseAdmin.from("stream_sessions").update({ status: "ended" }).eq("id", session.id);
          continue;
        }

        // Check if exhausted
        const remainingCredits = updatedProfile?.[0]?.credits ?? 0;
        if (remainingCredits <= 0) {
           await supabaseAdmin.from("stream_sessions").update({ status: "ended" }).eq("id", session.id);
           console.log(`[worker/billing] Session ${session.id} ended due to zero credits.`);
        } else {
           await supabaseAdmin
             .from("stream_sessions")
             .update({ last_billed_at: now.toISOString() })
             .eq("id", session.id);
        }
        processed++;
      }
    }

    return NextResponse.json({ success: true, processed });
  } catch (err: any) {
    console.error("[worker/billing] Exception:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
