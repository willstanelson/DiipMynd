// ============================================================================
// DiipMynd — Admin Credit Request Approval API
// GET  /api/admin/requests — List pending credit requests (paginated)
// POST /api/admin/requests — Approve a pending request (atomic + idempotent)
//
// Hardening vs. original (audit findings H4 / M3 / M4 / M5):
//   * Approval runs in a single DB transaction via approve_credit_request()
//     RPC → grant + status-flip + daily-cap all atomic, idempotent, no TOCTOU.
//   * GET is paginated (no more full-table scan / OOM under load).
//   * Errors are sanitized; internals never reach the client.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

const PAGE_SIZE = 50;
const DAILY_ADMIN_LIMIT = 500000;

/**
 * GET /api/admin/requests
 * Returns a bounded page of pending credit requests.
 */
export async function GET(request: Request) {
  try {
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data: requests, error } = await supabaseAdmin
      .from("credit_requests")
      .select("id, user_id, email, package_id, amount, status, payment_method, tx_hash, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("[admin-requests] Supabase fetch error:", error.message);
      return NextResponse.json({ error: "Failed to fetch credit requests." }, { status: 500 });
    }

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

    return NextResponse.json({ success: true, requests: safeRequests, page });
  } catch (err) {
    return apiError(err, "Failed to fetch requests.", 500);
  }
}

/**
 * POST /api/admin/requests
 * Approves and completes a pending credit request — atomically and idempotently.
 * Body: { requestId: string }
 */
export async function POST(request: Request) {
  try {
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { requestId } = body;

    if (!requestId || typeof requestId !== "string") {
      return NextResponse.json({ error: "requestId is required." }, { status: 400 });
    }

    // Single atomic transaction: idempotency + status flip + daily cap + grant.
    const { data, error } = await supabaseAdmin.rpc("approve_credit_request", {
      p_request_id: requestId,
      p_admin_id: adminUser.id,
      p_daily_limit: DAILY_ADMIN_LIMIT,
    });

    if (error) {
      console.error("[admin-requests] RPC error:", error.message);
      return NextResponse.json({ error: "Failed to approve request." }, { status: 500 });
    }

    const result = Array.isArray(data) ? data[0] : data;
    const code = result?.code;

    switch (code) {
      case "granted":
        return NextResponse.json({ success: true, newBalance: result.new_balance });
      case "already_completed":
        // Idempotent — safe retry, no double grant.
        return NextResponse.json({ success: true, message: "Request already processed." });
      case "not_found":
        return NextResponse.json({ error: "Credit request not found." }, { status: 404 });
      case "invalid_status":
        return NextResponse.json({ error: "Request is no longer pending." }, { status: 400 });
      case "daily_limit_exceeded":
        return NextResponse.json(
          {
            error: `Daily admin credit adjustment limit (${DAILY_LIMIT_LABEL}) exceeded.`,
          },
          { status: 400 }
        );
      default:
        console.error("[admin-requests] Unknown RPC code:", code);
        return NextResponse.json({ error: "Failed to approve request." }, { status: 500 });
    }
  } catch (err) {
    return apiError(err, "Failed to approve request.", 500);
  }
}

const DAILY_LIMIT_LABEL = DAILY_ADMIN_LIMIT.toLocaleString();
