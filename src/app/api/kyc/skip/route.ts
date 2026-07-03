// ============================================================================
// DiipMynd — Backend: Skip KYC Verification
// POST /api/kyc/skip
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

export async function POST() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // Prepare updates
    const updates: Record<string, any> = { kyc_status: "skipped" };
    
    // Defensive check: backstop terms acceptance if skipped directly
    if (!currentUser.termsAcceptedAt) {
      updates.terms_accepted_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", currentUser.id);

    if (error) {
      console.error("[kyc-skip] Supabase update error:", error.message);
      return NextResponse.json({ error: "Failed to skip KYC verification." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, "Failed to skip KYC.", 500);
  }
}
