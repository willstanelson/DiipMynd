// ============================================================================
// DiipMynd — Backend: Initialize Paystack Transaction
// POST /api/credits/initialize-paystack
//
// Generates a secure Paystack checkout session for the selected credits package.
// We map the package ID to the correct price in kobo (₦1 = 100 kobo) and send
// user information plus metadata (user_id, product) to Paystack.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// Packages definition with exact prices in Kobo (₦1 = 100 kobo)
const PAYSTACK_PACKAGES: Record<string, { amountKobo: number; name: string }> = {
  trial: { amountKobo: 4950000, name: "Trial Bundle (10 mins)" },       // ₦49,500
  starter: { amountKobo: 13500000, name: "Starter Bundle (30 mins)" },   // ₦135,000
  standard: { amountKobo: 24300000, name: "Standard Bundle (1 hour)" },  // ₦243,000
  pro: { amountKobo: 108000000, name: "Pro Bundle (5 hours)" },         // ₦1,080,000
};

export async function POST(request: Request) {
  try {
    // ── Guard: Authenticate user ─────────────────────────────────────────
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // ── Guard: Parse package details ─────────────────────────────────────
    const body = await request.json().catch(() => ({}));
    const { packageId } = body;

    if (!packageId || !PAYSTACK_PACKAGES[packageId]) {
      return NextResponse.json(
        { error: "A valid packageId (trial, starter, standard, pro) is required." },
        { status: 400 }
      );
    }

    const { amountKobo, name } = PAYSTACK_PACKAGES[packageId];
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      console.error("[paystack-init] PAYSTACK_SECRET_KEY is missing in environment.");
      return NextResponse.json(
        { error: "Payment processor is not configured on the server." },
        { status: 500 }
      );
    }

    // Determine the base request URL dynamically for redirecting back
    const origin = request.headers.get("origin") || "http://localhost:3000";
    const callbackUrl = `${origin}/DiipMynd/`;

    console.log(`[paystack-init] Initializing transaction for user ${currentUser.email}: ${name} (${amountKobo} kobo)`);

    // ── Initialize with Paystack API ──────────────────────────────────────
    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: currentUser.email,
        amount: amountKobo,
        callback_url: callbackUrl,
        metadata: {
          product: "diipmynd",
          userId: currentUser.id,
          packageId: packageId,
        },
      }),
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      console.error("[paystack-init] Paystack API error:", paystackData);
      throw new Error(paystackData.message || "Failed to contact Paystack billing server.");
    }

    return NextResponse.json({
      success: true,
      authorizationUrl: paystackData.data.authorization_url,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Checkout initialization failed.";
    console.error("[paystack-init] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
