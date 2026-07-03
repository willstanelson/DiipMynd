// ============================================================================
// DiipMynd — Backend: Verify Dojah KYC Reference
// POST /api/kyc/verify
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { referenceId } = body;

    if (!referenceId || typeof referenceId !== "string") {
      return NextResponse.json({ error: "referenceId is required." }, { status: 400 });
    }

    const appId = process.env.DOJAH_APP_ID;
    const secretKey = process.env.DOJAH_SECRET_KEY;

    if (!appId || !secretKey) {
      console.error("[kyc-verify] Dojah credentials missing in environment.");
      return NextResponse.json(
        { error: "KYC verification service is not configured on the server." },
        { status: 500 }
      );
    }

    // 1. Call Dojah API to fetch verification details
    console.log(`[kyc-verify] Contacting Dojah to verify reference: ${referenceId}`);
    const dojahRes = await fetch(
      `https://api.dojah.io/api/v1/kyc/verification?reference_id=${encodeURIComponent(referenceId)}`,
      {
        method: "GET",
        headers: {
          AppId: appId,
          Authorization: secretKey, // Raw secret key without Bearer prefix
        },
      }
    );

    const dojahData = await dojahRes.json();
    console.log(`[kyc-verify] Dojah API response status ${dojahRes.status}:`, JSON.stringify(dojahData));

    if (!dojahRes.ok) {
      return NextResponse.json(
        { error: dojahData.error || "Failed to confirm verification with Dojah." },
        { status: 400 }
      );
    }

    // 2. Extract verification status from Dojah response (resilient to different nestings)
    const verificationStatus =
      dojahData.verification_status ||
      dojahData.entity?.verification_status ||
      dojahData.data?.verification_status ||
      dojahData.data?.entity?.verification_status ||
      "";

    const isCompleted = verificationStatus === "Completed";

    if (!isCompleted) {
      return NextResponse.json(
        {
          error: `Identity verification has not completed. Status: ${verificationStatus || "unknown"}.`,
          status: verificationStatus,
        },
        { status: 422 }
      );
    }

    // 3. Backstop terms acceptance if not already recorded
    if (!currentUser.termsAcceptedAt) {
      const { error: termsErr } = await supabaseAdmin
        .from("profiles")
        .update({ terms_accepted_at: new Date().toISOString() })
        .eq("id", currentUser.id);

      if (termsErr) {
        console.error("[kyc-verify] Failed to update backstop terms_accepted_at:", termsErr.message);
      }
    }

    // 4. Invoke the atomic verify_and_award_kyc database RPC (prevents TOCTOU double-grants)
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("verify_and_award_kyc", {
      p_user_id: currentUser.id,
      p_reference_id: referenceId,
    });

    if (rpcErr) {
      console.error("[kyc-verify] RPC verify_and_award_kyc failed:", rpcErr.message);
      return NextResponse.json({ error: "Failed to apply verification state to account." }, { status: 500 });
    }

    const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    
    if (!result || result.ok === false) {
      return NextResponse.json(
        { error: result?.message || "Failed to reward credits or verify profile status." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      verified: true,
      creditsAwarded: !!result.credits_awarded,
      newBalance: result.new_balance,
      code: result.code,
    });
  } catch (err) {
    return apiError(err, "Failed to verify KYC reference.", 500);
  }
}
