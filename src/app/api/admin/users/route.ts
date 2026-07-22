// ============================================================================
// DiipMynd — Admin Users API
// GET  /api/admin/users?page=N — paginated user list (bounded, no OOM under load)
// POST /api/admin/users        — adjust credits / suspension for a user
//
// Hardening vs. original (audit findings M2 / M4 / M5):
//   * GET paginates profiles AND auth.users (no full-table scans per request).
//   * POST enforces a daily aggregate cap via the ledger (consistent with
//     admin/requests), preventing a rogue admin from minting unbounded credits.
//   * Errors sanitized.
//   * self-protection: an admin cannot demote/suspend themselves accidentally.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { adjustCredits, UserNotFoundError } from "@/lib/credits";
import { supabaseAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

const PAGE_SIZE = 50;
const MAX_ADMIN_ADJUSTMENT = 100000;
const DAILY_ADMIN_LIMIT = 500000;

/**
 * GET /api/admin/users?page=N
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

    // One bounded page of profiles.
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, credits, is_admin, created_at, has_funded_credits")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("[admin-users] Supabase fetch error:", error.message);
      return NextResponse.json({ error: "Failed to fetch users list." }, { status: 500 });
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ success: true, users: [], page });
    }

    // Fetch suspension flags ONLY for the users on this page (no full scan).
    const suspensionMap = new Map<string, boolean>();
    try {
      await Promise.all(
        profiles.map(async (p) => {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(p.id);
          suspensionMap.set(p.id, !!authUser?.user?.app_metadata?.is_suspended);
        })
      );
    } catch (authErr) {
      console.error("[admin-users] Failed to fetch suspension flags:", authErr);
    }

    const safeUsers = profiles.map((p) => ({
      id: p.id,
      email: p.email || "",
      credits: p.credits,
      isAdmin: p.is_admin,
      createdAt: p.created_at,
      isSuspended: suspensionMap.get(p.id) || false,
      hasFundedCredits: !!p.has_funded_credits,
    }));

    return NextResponse.json({ success: true, users: safeUsers, page });
  } catch (err) {
    return apiError(err, "Failed to fetch users list.", 500);
  }
}

/**
 * POST /api/admin/users
 * Body: { userId, amount?, isSuspended?, reason?, markAsFunded? }
 */
export async function POST(request: Request) {
  try {
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { userId, amount, isSuspended, reason, markAsFunded } = body;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    // An admin cannot suspend themselves (prevents a self-lockout footgun).
    if (typeof isSuspended === "boolean" && userId === adminUser.id && isSuspended) {
      return NextResponse.json({ error: "You cannot suspend your own account." }, { status: 400 });
    }

    // Suspension flag update (admin-only via service role).
    if (typeof isSuspended === "boolean") {
      const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: { is_suspended: isSuspended },
      });
      if (authUpdateError) {
        console.error("[admin-users] auth update error:", authUpdateError.message);
        return NextResponse.json(
          { error: "Failed to update user suspension status." },
          { status: 500 }
        );
      }
    }

    const { data: profile, error: selectError } = await supabaseAdmin
      .from("profiles")
      .select("credits, is_admin, email, created_at, has_funded_credits")
      .eq("id", userId)
      .single();

    if (selectError || !profile) {
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    // One-way promotion to funded status (never demotes)
    if (markAsFunded === true) {
      const { error: fundErr } = await supabaseAdmin
        .from("profiles")
        .update({ has_funded_credits: true })
        .eq("id", userId);
      if (fundErr) {
        console.error("[admin-users] Failed to mark user as funded:", fundErr.message);
      }
    }

    let finalCredits = profile.credits;

    if (typeof amount === "number" && amount !== 0) {
      if (Math.abs(amount) > MAX_ADMIN_ADJUSTMENT) {
        return NextResponse.json(
          { error: `Adjustment exceeds safety limit of ${MAX_ADMIN_ADJUSTMENT}.` },
          { status: 400 }
        );
      }

      // Enforce the same daily aggregate cap as admin/requests, server-side.
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { data: ledgerEntries } = await supabaseAdmin
        .from("credit_ledger")
        .select("delta")
        .eq("admin_id", adminUser.id)
        .gte("created_at", startOfDay.toISOString());

      const dailyTotal = (ledgerEntries || []).reduce(
        (sum, e) => sum + (e.delta > 0 ? e.delta : 0),
        0
      );
      if (amount > 0 && dailyTotal + amount > DAILY_ADMIN_LIMIT) {
        return NextResponse.json(
          { error: `Daily admin credit grant limit (${DAILY_ADMIN_LIMIT}) exceeded.` },
          { status: 400 }
        );
      }

      finalCredits = await adjustCredits(
        userId,
        amount,
        reason || "Manual Admin Adjustment",
        "admin-adjustment",
        adminUser.id
      );
    }

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const updatedSuspended = authUser?.user
      ? !!authUser.user.app_metadata?.is_suspended
      : isSuspended || false;

    const safeUser = {
      id: userId,
      email: profile.email || "",
      credits: finalCredits,
      isAdmin: profile.is_admin,
      createdAt: profile.created_at,
      isSuspended: updatedSuspended,
      hasFundedCredits: markAsFunded === true ? true : !!profile.has_funded_credits,
    };

    return NextResponse.json({ success: true, user: safeUser });
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }
    return apiError(err, "Failed to update user.", 500);
  }
}
