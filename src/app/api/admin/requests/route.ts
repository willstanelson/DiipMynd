// ============================================================================
// DiipMynd — Admin Credit Request Approval API
// GET  /api/admin/requests — List pending credit requests
// POST /api/admin/requests — Approve a pending request (atomic crediting)
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { adjustCredits, UserNotFoundError } from "@/lib/credits";
import { supabaseAdmin } from "@/lib/supabase/server";

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
    const { data: requests, error } = await supabaseAdmin
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
 * Approves and completes a pending credit request, atomically funding the user's account.
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
    const { data: req, error: fetchReqError } = await supabaseAdmin
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

    // 1b. Enforce daily aggregate cap of 500k credits per admin
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const { data: ledgerEntries, error: ledgerError } = await supabaseAdmin
      .from("credit_ledger")
      .select("delta")
      .eq("admin_id", adminUser.id)
      .gte("created_at", startOfDay.toISOString());

    if (ledgerError) {
      console.error("[admin-requests] Failed to fetch admin ledger:", ledgerError.message);
      return NextResponse.json({ error: "Failed to verify admin quota." }, { status: 500 });
    }

    const dailyTotal = (ledgerEntries || []).reduce((sum, entry) => sum + (entry.delta > 0 ? entry.delta : 0), 0);
    const DAILY_LIMIT = 500000;

    if (dailyTotal + req.amount > DAILY_LIMIT) {
      return NextResponse.json({ error: `Daily admin credit adjustment limit (${DAILY_LIMIT}) exceeded. Current daily total: ${dailyTotal}` }, { status: 400 });
    }

    // 2. Atomically fund user account
    await adjustCredits(req.user_id, req.amount, "Approved Manual Request", "admin-approval", adminUser.id);

    // 3. Mark request as completed
    const { error: reqUpdateError } = await supabaseAdmin
      .from("credit_requests")
      .update({ status: "completed" })
      .eq("id", requestId);

    if (reqUpdateError) {
      console.error("[admin-requests] Supabase request status update error:", reqUpdateError.message);
      return NextResponse.json({ error: "Failed to mark request as completed." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "User associated with this request not found." }, { status: 404 });
    }

    const msg = err instanceof Error ? err.message : "Failed to approve request";
    console.error("[admin-requests] POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
