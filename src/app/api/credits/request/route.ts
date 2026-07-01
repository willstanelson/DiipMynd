import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sanitizeInput } from "@/lib/sanitize";
import { apiError } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json();
    const { packageId, paymentMethod, txHash } = body;
    const { PACKAGE_CREDITS } = await import("@/lib/packages");
    const amount = PACKAGE_CREDITS[packageId];

    if (!packageId || !amount) {
      return NextResponse.json({ error: "Valid packageId is required." }, { status: 400 });
    }

    // Limit active pending requests to prevent abuse/spam
    const { data: pendingRequests, error: selectError } = await supabaseAdmin
      .from("credit_requests")
      .select("id")
      .eq("user_id", currentUser.id)
      .eq("status", "pending");

    if (selectError) {
      console.error("[credits-request] Supabase fetch error:", selectError.message);
      return NextResponse.json({ error: "Failed to verify existing requests." }, { status: 500 });
    }

    if (pendingRequests && pendingRequests.length >= 3) {
      return NextResponse.json(
        { error: "You already have pending credit requests. Please wait for the developer to approve them." },
        { status: 429 }
      );
    }

    const sanitizedPaymentMethod = paymentMethod ? sanitizeInput(paymentMethod) : undefined;
    const sanitizedTxHash = txHash ? sanitizeInput(txHash) : undefined;

    const { error: insertError } = await supabaseAdmin
      .from("credit_requests")
      .insert({
        user_id: currentUser.id,
        email: currentUser.email,
        package_id: packageId,
        amount,
        status: "pending",
        payment_method: sanitizedPaymentMethod,
        tx_hash: sanitizedTxHash,
      });

    if (insertError) {
      console.error("[credits-request] Supabase insert error:", insertError.message);
      return NextResponse.json({ error: "Failed to submit credit request." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, "Failed to submit credit request.", 500);
  }
}
