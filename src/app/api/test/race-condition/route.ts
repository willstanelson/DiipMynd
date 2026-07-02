import { NextResponse } from "next/server";
import { reserveCreditsEscrow, settleReservationEscrow } from "@/lib/credits";
import { getCurrentUser } from "@/lib/auth";

export async function POST() {
  // Only allow in development or testing mode
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_MOCK_ESCROW !== "true") {
    return NextResponse.json({ error: "Prohibited in production." }, { status: 403 });
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const referenceId = `race-${Date.now()}`;

  // Execute concurrently
  const [res1, res2] = await Promise.all([
    reserveCreditsEscrow(currentUser.id, 10, "job", referenceId, 120),
    reserveCreditsEscrow(currentUser.id, 10, "job", referenceId, 120)
  ]);

  // Clean up
  if (res1.ok && res1.reservationId) {
    await settleReservationEscrow(res1.reservationId, 0, "failure");
  }

  return NextResponse.json({
    success: true,
    res1,
    res2
  });
}
