// ============================================================================
// DiipMynd — Admin App Settings API
// GET  /api/admin/settings — fetch current operational settings (masked)
// POST /api/admin/settings — update an operational setting
//
// Admin-auth-gated. Whitelisted to specific keys only ("decart_api_key_test")
// to prevent arbitrary DB pollution.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAppSetting, setAppSetting } from "@/lib/appSettings";
import { apiError } from "@/lib/api";

const ALLOWED_KEYS = new Set(["decart_api_key_test"]);

function maskKey(val: string | null): string {
  if (!val) return "";
  if (val.length <= 8) return "********";
  return val.slice(0, 4) + "..." + val.slice(-4);
}

export async function GET() {
  try {
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    const testKeyRaw = await getAppSetting("decart_api_key_test");

    return NextResponse.json({
      success: true,
      settings: {
        decart_api_key_test: maskKey(testKeyRaw),
        decart_api_key_test_configured: !!testKeyRaw,
      },
    });
  } catch (err) {
    return apiError(err, "Failed to fetch app settings.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const adminUser = await getCurrentUser();
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { key, value } = body;

    if (!key || typeof key !== "string" || !ALLOWED_KEYS.has(key)) {
      return NextResponse.json(
        { error: `Invalid key. Allowed keys: ${Array.from(ALLOWED_KEYS).join(", ")}` },
        { status: 400 }
      );
    }

    if (typeof value !== "string" || value.trim().length < 8) {
      return NextResponse.json(
        { error: "Setting value must be a non-empty string of at least 8 characters." },
        { status: 400 }
      );
    }

    const result = await setAppSetting(key, value.trim(), adminUser.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Failed to update setting." }, { status: 500 });
    }

    console.log(`[admin-settings] Admin ${adminUser.id} updated setting '${key}'.`);

    return NextResponse.json({
      success: true,
      message: `Setting '${key}' updated successfully.`,
      key,
      maskedValue: maskKey(value.trim()),
    });
  } catch (err) {
    return apiError(err, "Failed to update app setting.", 500);
  }
}
