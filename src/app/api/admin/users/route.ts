import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/admin/users
 * Returns list of all registered users.
 */
export async function GET() {
  try {
    // Authenticate and authorize admin
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    // Fetch all profiles from Supabase
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, credits, is_admin, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[admin-users] Supabase fetch error:", error.message);
      return NextResponse.json({ error: "Failed to fetch users list." }, { status: 500 });
    }

    // Fetch all auth users to check for is_suspended flag in app_metadata
    const suspensionMap = new Map<string, boolean>();
    try {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
      if (!authError && authData?.users) {
        authData.users.forEach((u) => {
          suspensionMap.set(u.id, !!u.app_metadata?.is_suspended);
        });
      }
    } catch (authErr) {
      console.error("[admin-users] Failed to fetch auth users metadata:", authErr);
    }

    // Map profiles to match the SafeUser schema in frontend
    const safeUsers = (profiles || []).map((p) => ({
      id: p.id,
      email: p.email || "",
      credits: p.credits,
      isAdmin: p.is_admin,
      createdAt: p.created_at,
      isSuspended: suspensionMap.get(p.id) || false,
    }));

    return NextResponse.json({ success: true, users: safeUsers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch users list";
    console.error("[admin-users] GET error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/admin/users
 * Updates the credit balance for a specified user.
 * Body parameter: { userId: string, amount: number }
 */
export async function POST(request: Request) {
  try {
    // Authenticate and authorize admin
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    const body = await request.json();
    const { userId, amount, isSuspended } = body;

    if (!userId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    // If suspension status update is requested
    if (typeof isSuspended === "boolean") {
      const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { app_metadata: { is_suspended: isSuspended } }
      );
      if (authUpdateError) {
        console.error("[admin-users] Supabase auth update error:", authUpdateError.message);
        return NextResponse.json({ error: "Failed to update user suspension status." }, { status: 500 });
      }
    }

    // Fetch user's current profile
    const { data: profile, error: selectError } = await supabaseAdmin
      .from("profiles")
      .select("credits, is_admin, email, created_at")
      .eq("id", userId)
      .single();

    if (selectError || !profile) {
      console.error("[admin-users] Supabase select error:", selectError?.message);
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    let finalCredits = profile.credits;

    if (typeof amount === "number") {
      const newCredits = Math.max(0, profile.credits + amount);

      // Update credits in Supabase
      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({ credits: newCredits })
        .eq("id", userId);

      if (updateError) {
        console.error("[admin-users] Supabase update error:", updateError.message);
        return NextResponse.json({ error: "Failed to update user credits." }, { status: 500 });
      }
      finalCredits = newCredits;
    }

    // Get latest suspension status
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const updatedSuspended = authUser?.user ? !!authUser.user.app_metadata?.is_suspended : (isSuspended || false);

    const safeUser = {
      id: userId,
      email: profile.email || "",
      credits: finalCredits,
      isAdmin: profile.is_admin,
      createdAt: profile.created_at,
      isSuspended: updatedSuspended,
    };

    return NextResponse.json({ success: true, user: safeUser });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update credits";
    console.error("[admin-users] POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
