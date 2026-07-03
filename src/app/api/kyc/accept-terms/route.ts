// ============================================================================
// DiipMynd — Backend: Accept Terms of Service
// POST /api/kyc/accept-terms
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

    // Set terms_accepted_at via service_role to bypass read-only client grants
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq("id", currentUser.id);

    if (error) {
      console.error("[kyc-accept-terms] Supabase update error:", error.message);
      return NextResponse.json({ error: "Failed to accept terms and conditions." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, "Failed to process terms acceptance.", 500);
  }
}
