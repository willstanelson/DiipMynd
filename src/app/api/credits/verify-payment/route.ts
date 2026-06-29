// ============================================================================
// DiipMynd — Backend: Paystack Payment Verification Handler
// POST /api/credits/verify-payment
//
// This endpoint manually verifies a Paystack checkout transaction reference.
// It is called by the frontend upon redirect to ensure immediate crediting
// and feedback (toasts) without waiting for webhook delivery.
//
// CHANGED: Moved from GET to POST to prevent CSRF attacks. GET routes that
// mutate server state are a textbook CSRF vulnerability.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { adjustCredits, UserNotFoundError } from "@/lib/credits";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PACKAGE_CREDITS, PACKAGE_PRICES_KOBO } from "@/lib/packages";

export async function POST(request: Request) {
  try {
    // ── Guard: Authenticate user ─────────────────────────────────────────
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // ── Guard: Extract reference from body ────────────────────────────────
    const body = await request.json().catch(() => ({}));
    const reference = body.reference;

    if (!reference || typeof reference !== "string") {
      return NextResponse.json({ error: "Transaction reference is required." }, { status: 400 });
    }

    console.log(`[verify-payment] Verifying transaction reference: ${reference} for user ${currentUser.email}`);

    // ── Check if already processed (Idempotency) ──────────────────────────
    // We defer the actual DB insert/update to the end to prevent TOCTOU races,
    // but we can still do an early check to save the Paystack API call if it's already approved.
    const { data: existingLog } = await supabaseAdmin
      .from("credit_requests")
      .select("id, status")
      .eq("tx_hash", reference)
      .maybeSingle();

    if (existingLog && existingLog.status === "approved") {
      console.log(`[verify-payment] Reference ${reference} already approved and processed.`);
      return NextResponse.json({ success: true, message: "Payment already processed." });
    }

    // ── Verify with Paystack API ──────────────────────────────────────────
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      console.error("[verify-payment] PAYSTACK_SECRET_KEY is missing.");
      return NextResponse.json({ error: "Processor key is missing on the server." }, { status: 500 });
    }

    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      console.error("[verify-payment] Paystack API error:", paystackData);
      return NextResponse.json({ error: paystackData.message || "Failed to verify transaction." }, { status: 400 });
    }

    const { status: paystackStatus, amount, metadata, customer, channel } = paystackData.data;

    // ── Guard: Check payment status ──────────────────────────────────────
    if (paystackStatus !== "success") {
      console.warn(`[verify-payment] Paystack transaction status is: ${paystackStatus}`);
      return NextResponse.json({
        success: false,
        message: `Transaction was not successful. Status: ${paystackStatus}`,
      });
    }

    // ── Guard: Verify DiipMynd metadata ───────────────────────────────────
    const { product, userId, packageId } = metadata || {};
    if (product !== "diipmynd" || !userId || !packageId) {
      console.warn("[verify-payment] Metadata mismatch: Not a DiipMynd session.", metadata);
      return NextResponse.json({ error: "Invalid transaction metadata." }, { status: 400 });
    }

    // Ensure we are crediting the correct user (currentUser)
    if (userId !== currentUser.id) {
      console.warn(`[verify-payment] User ID mismatch. Metadata: ${userId}, Session: ${currentUser.id}`);
      return NextResponse.json({ error: "User session mismatch." }, { status: 403 });
    }

    const creditsToAdd = PACKAGE_CREDITS[packageId];
    if (!creditsToAdd) {
      console.error(`[verify-payment] Invalid package ID in metadata: ${packageId}`);
      return NextResponse.json({ error: "Invalid package identifier." }, { status: 400 });
    }

    const expectedAmountKobo = PACKAGE_PRICES_KOBO[packageId];
    if (!expectedAmountKobo || amount < expectedAmountKobo) {
      console.warn(`[verify-payment] Amount mismatch: paid ${amount} kobo, expected ${expectedAmountKobo}`);
      return NextResponse.json({ error: "Payment amount does not match package price." }, { status: 400 });
    }

    // ── Atomically mark as approved ───────────────────────────────────────
    // If it fails or returns no data, someone else already inserted it (race condition prevented)
    const { data: insertedData, error: logInsertError } = await supabaseAdmin
      .from("credit_requests")
      .upsert({
        user_id: currentUser.id,
        email: customer?.email || currentUser.email,
        package_id: packageId,
        amount: creditsToAdd,
        status: "approved",
        payment_method: `Paystack (${channel || "card"})`,
        tx_hash: reference,
      }, { onConflict: "tx_hash", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();

    if (logInsertError || !insertedData) {
      console.log(`[verify-payment] Race condition prevented. Reference ${reference} already processed.`);
      return NextResponse.json({ success: true, message: "Payment already processed." });
    }

    const newCredits = await adjustCredits(currentUser.id, creditsToAdd, `Paystack Payment Verification (${reference})`, "paystack-verify");

    console.log(`[verify-payment] Successfully credited user ${currentUser.email} with ${creditsToAdd} credits.`);
    return NextResponse.json({ success: true, credits: newCredits });

  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    const msg = err instanceof Error ? err.message : "Internal verification error.";
    console.error("[verify-payment] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
