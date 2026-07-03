// ============================================================================
// DiipMynd — Backend: Initialize Dojah KYC Session
// GET /api/kyc/initialize
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/api";

export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const appId = process.env.DOJAH_APP_ID || "";
    const publicKey = process.env.DOJAH_PUBLIC_KEY || "";
    const widgetId = process.env.DOJAH_WIDGET_ID || "";

    if (!appId || !publicKey || !widgetId) {
      console.error("[kyc-initialize] Dojah config environment variables are missing.");
      return NextResponse.json(
        { error: "KYC provider is not configured on the server." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      appId,
      publicKey,
      widgetId,
    });
  } catch (err) {
    return apiError(err, "Failed to initialize KYC config.", 500);
  }
}
