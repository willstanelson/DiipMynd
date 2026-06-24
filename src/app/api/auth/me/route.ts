import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ user });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch user state";
    console.error("[auth-me] Error fetching session user:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
