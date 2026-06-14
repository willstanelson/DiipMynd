import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/admin/requests
 * Returns list of all pending credit requests.
 */
export async function GET() {
  try {
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    // Fetch all pending requests from Supabase
    const { data: requests, error } = await supabase
      .from("credit_requests")
      .select("id, user_id, email, package_id, amount, status, payment_method, tx_hash, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[admin-requests] Supabase fetch error:", error.message);
      return NextResponse.json({ error: "Failed to fetch credit requests." }, { status: 500 });
    }

    // Map fields to match frontend credit requests type
    const safeRequests = (requests || []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      email: r.email,
      packageId: r.package_id,
      amount: r.amount,
      status: r.status,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      txHash: r.tx_hash,
    }));

    return NextResponse.json({ success: true, requests: safeRequests });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch requests";
    console.error("[admin-requests] GET error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/admin/requests
 * Approves and completes a pending credit request, automatically funding the user's account.
 * Body parameter: { requestId: string }
 */
export async function POST(request: Request) {
  try {
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    const body = await request.json();
    const { requestId } = body;

    if (!requestId) {
      return NextResponse.json({ error: "requestId is required." }, { status: 400 });
    }

    // 1. Fetch request details
    const { data: req, error: fetchReqError } = await supabase
      .from("credit_requests")
      .select("id, user_id, amount, status")
      .eq("id", requestId)
      .single();

    if (fetchReqError || !req) {
      console.error("[admin-requests] Supabase fetch request error:", fetchReqError?.message);
      return NextResponse.json({ error: "Credit request not found." }, { status: 404 });
    }

    if (req.status !== "pending") {
      return NextResponse.json({ error: "Request is already processed." }, { status: 400 });
    }

    // 2. Fetch target user's current profile credits
    const { data: targetProfile, error: fetchProfileError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", req.user_id)
      .single();

    if (fetchProfileError || !targetProfile) {
      console.error("[admin-requests] Supabase fetch target profile error:", fetchProfileError?.message);
      return NextResponse.json({ error: "User associated with this request not found." }, { status: 404 });
    }

    // 3. Fund user account
    const newCredits = targetProfile.credits + req.amount;
    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", req.user_id);

    if (profileUpdateError) {
      console.error("[admin-requests] Supabase target profile update error:", profileUpdateError.message);
      return NextResponse.json({ error: "Failed to fund user credits." }, { status: 500 });
    }

    // 4. Mark request as completed
    const { error: reqUpdateError } = await supabase
      .from("credit_requests")
      .update({ status: "completed" })
      .eq("id", requestId);

    if (reqUpdateError) {
      console.error("[admin-requests] Supabase request status update error:", reqUpdateError.message);
      return NextResponse.json({ error: "Failed to mark request as completed." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to approve request";
    console.error("[admin-requests] POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
