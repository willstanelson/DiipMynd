// ============================================================================
// DiipMynd — Workspace Library CRUD API
// GET /api/library
// POST /api/library
// DELETE /api/library?id=<asset_id>
//
// Exposes CRUD access to the user's workspace library (scripts, images, etc.).
// Enforces user session authentication.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getUserAssets, addAsset, deleteAsset } from "@/lib/library";
import { sanitizeInput } from "@/lib/sanitize";
import { verifyMediaToken } from "@/lib/jwt";
import { apiError } from "@/lib/api";
import crypto from "crypto";

export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const assets = await getUserAssets(currentUser.id);
    return NextResponse.json({ success: true, assets });
  } catch (err) {
    return apiError(err, "Failed to retrieve library assets.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { type, name, url, model, prompt, telegramChatId, telegramMessageId } = body;

    if (!type || !name || !url) {
      return NextResponse.json(
        { error: "Missing required parameters: type, name, and url are required." },
        { status: 400 }
      );
    }

    if (!["video", "image", "audio", "script"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid asset type. Supported: video, image, audio, script." },
        { status: 400 }
      );
    }

    const sanitizedName = sanitizeInput(name);
    const sanitizedModel = model ? sanitizeInput(model) : undefined;
    const sanitizedPrompt = prompt ? sanitizeInput(prompt) : undefined;

    let finalUrl = url;
    let telegramFileId: string | null = null;
    const generatedId = crypto.randomUUID();

    // ── Intercept JWT tokens and convert to persistent ID URLs ────────────
    // Parse the URL robustly so any param ordering (e.g. ?id=..&token=.., or
    // a hash/encoded form) is handled, rather than a fragile substring match.
    try {
      const urlObj = new URL(url, "http://localhost");
      if (urlObj.pathname === "/api/library/media") {
        const token = urlObj.searchParams.get("token");
        if (token) {
          const payload = await verifyMediaToken(token);
          if (payload && payload.userId === currentUser.id) {
            telegramFileId = payload.fileId;
            finalUrl = `/api/library/media?id=${generatedId}`;
          } else {
            return NextResponse.json(
              { error: "Invalid or expired media token." },
              { status: 403 }
            );
          }
        }
      }
    } catch {
      // Not a parseable URL — keep finalUrl as-is.
    }

    const asset = await addAsset({
      user_id: currentUser.id,
      type,
      name: sanitizedName,
      url: finalUrl,
      model: sanitizedModel,
      prompt: sanitizedPrompt,
      telegram_chat_id: telegramChatId ? Number(telegramChatId) : null,
      telegram_message_id: telegramMessageId ? Number(telegramMessageId) : null,
      telegram_file_id: telegramFileId,
    }, generatedId);

    console.log(`[library-api] Asset added for ${currentUser.email}: ${name} (${type})`);

    return NextResponse.json({
      success: true,
      asset,
    });
  } catch (err) {
    return apiError(err, "Failed to save library asset.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Missing asset ID parameter." },
        { status: 400 }
      );
    }

    const success = await deleteAsset(id, currentUser.id);

    if (!success) {
      return NextResponse.json(
        { error: "Asset not found or access denied." },
        { status: 404 }
      );
    }

    console.log(`[library-api] Asset deleted for ${currentUser.email}: ID ${id}`);

    return NextResponse.json({
      success: true,
    });
  } catch (err) {
    return apiError(err, "Failed to delete library asset.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { id, pinned } = body;

    if (!id || typeof pinned !== "boolean") {
      return NextResponse.json(
        { error: "Missing parameters: id and pinned (boolean) are required." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("library_assets")
      .update({ pinned })
      .eq("id", id)
      .eq("user_id", currentUser.id)
      .select();

    if (error || !data || data.length === 0) {
      return NextResponse.json(
        { error: "Asset not found or failed to update." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err, "Failed to update library asset.", 500);
  }
}
