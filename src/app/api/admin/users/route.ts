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

    // Map profiles to match the SafeUser schema in frontend
    const safeUsers = (profiles || []).map((p) => ({
      id: p.id,
      email: p.email || "",
      credits: p.credits,
      isAdmin: p.is_admin,
      createdAt: p.created_at,
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
    const { userId, amount } = body;

    if (!userId || typeof amount !== "number") {
      return NextResponse.json({ error: "userId and amount (number) are required." }, { status: 400 });
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

    const safeUser = {
      id: userId,
      email: profile.email || "",
      credits: newCredits,
      isAdmin: profile.is_admin,
      createdAt: profile.created_at,
    };

    return NextResponse.json({ success: true, user: safeUser });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update credits";
    console.error("[admin-users] POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
