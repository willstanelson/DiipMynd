// ============================================================================
// DiipMynd — Backend: Paystack Webhook Handler
// POST /api/webhooks/paystack
//
// This route processes success webhooks from Paystack (forwarded securely
// by the parent Trustlink server). It verifies the signature, verifies it
// is for DiipMynd, credits the user's balance, and logs the transaction.
// ============================================================================

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

// Credit packages mapping (matching checkout definitions)
const PACKAGE_CREDITS: Record<string, number> = {
  trial: 600,       // 10 minutes
  starter: 1800,    // 30 minutes
  standard: 3600,   // 1 hour
  pro: 18000,       // 5 hours
};

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-paystack-signature");

    if (!signature) {
      console.warn("[paystack-webhook] Missing x-paystack-signature header.");
      return NextResponse.json({ error: "Missing signature." }, { status: 401 });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY || "";
    
    // ── Verify Signature ──────────────────────────────────────────────────
    const expectedSignature = crypto
      .createHmac("sha512", secretKey)
      .update(rawBody)
      .digest("hex");

    if (signature !== expectedSignature) {
      console.error("[paystack-webhook] Invalid signature mismatch.");
      return NextResponse.json({ error: "Invalid signature validation." }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);

    // We only process charge.success events
    if (payload.event !== "charge.success") {
      return NextResponse.json({ success: true, message: `Ignored event: ${payload.event}` });
    }

    const { data } = payload;
    const { product, userId, packageId } = data.metadata || {};

    // ── Verify it belongs to DiipMynd ──────────────────────────────────────
    if (product !== "diipmynd" || !userId || !packageId) {
      console.log("[paystack-webhook] Ignored transaction (not a DiipMynd session).");
      return NextResponse.json({ success: true, message: "Ignored transaction." });
    }

    const creditsToAdd = PACKAGE_CREDITS[packageId];
    if (!creditsToAdd) {
      console.error(`[paystack-webhook] Invalid packageId: ${packageId}`);
      return NextResponse.json({ error: "Invalid package identifier." }, { status: 400 });
    }

    console.log(`[paystack-webhook] Processing payment for user: ${userId}. Package: ${packageId} (${creditsToAdd} credits)`);

    // ── Fetch current user profile ─────────────────────────────────────────
    const { data: profile, error: selectError } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (selectError || !profile) {
      console.error("[paystack-webhook] Failed to load target profile:", selectError?.message);
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    // ── Credit User Balance & Log Transaction ─────────────────────────────
    const newCredits = profile.credits + creditsToAdd;

    // Run updates sequentially
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", userId);

    if (updateError) {
      console.error("[paystack-webhook] Failed to update credits:", updateError.message);
      return NextResponse.json({ error: "Failed to update credits." }, { status: 500 });
    }

    // Log the transaction in the existing credit_requests table
    const { error: logError } = await supabaseAdmin
      .from("credit_requests")
      .insert({
        user_id: userId,
        email: data.customer.email,
        package_id: packageId,
        amount: creditsToAdd,
        status: "approved",
        payment_method: `Paystack (${data.channel || "card"})`,
        tx_hash: data.reference,
      });

    if (logError) {
      // Log it but do not fail checkout (user has already been credited)
      console.error("[paystack-webhook] Failed to write credit_requests log:", logError.message);
    }

    console.log(`[paystack-webhook] User ${userId} credited with ${creditsToAdd} credits successfully.`);

    return NextResponse.json({ success: true, message: "Credits updated successfully." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Webhook processing failed.";
    console.error("[paystack-webhook] Webhook crashed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
