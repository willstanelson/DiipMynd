import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json();
    const { packageId, amount, paymentMethod, txHash } = body;

    if (!packageId || typeof amount !== "number") {
      return NextResponse.json({ error: "packageId and amount are required." }, { status: 400 });
    }

    // Limit active pending requests to prevent abuse/spam
    const { data: pendingRequests, error: selectError } = await supabase
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

    const { error: insertError } = await supabase
      .from("credit_requests")
      .insert({
        user_id: currentUser.id,
        email: currentUser.email,
        package_id: packageId,
        amount,
        status: "pending",
        payment_method: paymentMethod,
        tx_hash: txHash,
      });

    if (insertError) {
      console.error("[credits-request] Supabase insert error:", insertError.message);
      return NextResponse.json({ error: "Failed to submit credit request." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Request failed";
    console.error("[credits-request] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
