import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST() {
  try {
    // Ensure user is authenticated
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    // Fetch profile details from Supabase
    const { data: profile, error: selectError } = await supabaseAdmin
      .from("profiles")
      .select("credits, is_admin")
      .eq("id", currentUser.id)
      .single();

    if (selectError || !profile) {
      console.error("[heartbeat] Failed to fetch user profile from Supabase:", selectError?.message);
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    // Admins are not billed credits for streaming
    if (profile.is_admin) {
      return NextResponse.json({
        success: true,
        credits: profile.credits,
      });
    }

    // Check if the user is already out of credits
    if (profile.credits <= 0) {
      return NextResponse.json({
        success: false,
        credits: 0,
        error: "Insufficient credits.",
      });
    }

    // Deduct 10 credits for the 10-second active stream chunk
    const consumptionRate = 10;
    const newCredits = Math.max(0, profile.credits - consumptionRate);

    // Save changes to Supabase
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", currentUser.id);

    if (updateError) {
      console.error("[heartbeat] Failed to deduct credits in Supabase:", updateError.message);
      return NextResponse.json({ error: "Failed to process credit deduction." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      credits: newCredits,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Heartbeat processing failed";
    console.error("[heartbeat] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
