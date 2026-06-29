// ============================================================================
// DiipMynd — Backend: Paystack Webhook Handler
// POST /api/webhooks/paystack
//
// This route processes success webhooks from Paystack. It verifies the HMAC
// signature, checks if the transaction is for DiipMynd, atomically credits
// the user's balance, and logs the transaction with idempotency protection
// to prevent double-crediting from webhook retries.
// ============================================================================

import { NextResponse } from "next/server";
import crypto from "crypto";
import { adjustCredits, UserNotFoundError } from "@/lib/credits";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PACKAGE_CREDITS } from "@/lib/packages";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-paystack-signature");

    if (!signature) {
      console.warn("[paystack-webhook] Missing x-paystack-signature header.");
      return NextResponse.json({ error: "Missing signature." }, { status: 401 });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      console.error("[paystack-webhook] PAYSTACK_SECRET_KEY is missing. Refusing to process.");
      return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
    }
    
    // ── Verify Signature ──────────────────────────────────────────────────
    const expectedSignature = crypto
      .createHmac("sha512", secretKey)
      .update(rawBody)
      .digest("hex");

    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
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

    // ── Idempotency: Check if this reference has already been processed ───
    const { data: existingLog, error: fetchLogErr } = await supabaseAdmin
      .from("credit_requests")
      .select("id, status")
      .eq("tx_hash", data.reference)
      .maybeSingle();

    if (fetchLogErr) {
      console.error("[paystack-webhook] DB idempotency check error:", fetchLogErr.message);
    }

    if (existingLog?.status === "approved") {
      console.log(`[paystack-webhook] Reference ${data.reference} already processed. Skipping.`);
      return NextResponse.json({ success: true, message: "Already processed." });
    }

    console.log(`[paystack-webhook] Processing payment for user: ${userId}. Package: ${packageId} (${creditsToAdd} credits)`);

    // ── Atomically mark as approved ───────────────────────────────────────
    let isWinner = false;

    if (existingLog) {
      // It exists. We must atomically flip it from pending to approved.
      // If it's already approved, this update will return no rows.
      const { data: updated } = await supabaseAdmin
        .from("credit_requests")
        .update({ status: "approved" })
        .eq("id", existingLog.id)
        .eq("status", "pending")
        .select()
        .maybeSingle();

      if (updated) {
        isWinner = true;
      }
    } else {
      // Insert new approved record. Unique constraint on tx_hash prevents races.
      const { error: insertErr } = await supabaseAdmin
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

      if (!insertErr) {
        isWinner = true;
      }
    }

    if (!isWinner) {
      console.log(`[paystack-webhook] Lost the race. Reference ${data.reference} already processed.`);
      return NextResponse.json({ success: true, message: "Already processed." });
    }

    // ── Atomically credit user balance ────────────────────────────────────
    const newCredits = await adjustCredits(userId, creditsToAdd, `Paystack Webhook Payment (${data.reference})`, "paystack");

    console.log(`[paystack-webhook] User ${userId} credited with ${creditsToAdd} credits successfully.`);

    return NextResponse.json({ success: true, message: "Credits updated successfully." });
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      console.error("[paystack-webhook] User profile not found for webhook crediting.");
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    const msg = err instanceof Error ? err.message : "Webhook processing failed.";
    console.error("[paystack-webhook] Webhook crashed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
