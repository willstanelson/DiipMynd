// ============================================================================
// DiipMynd — Telegram Media Proxy API
// GET /api/library/media?fileId=<file_id>
//
// Streams media from Telegram servers to the client without exposing the
// server's TELEGRAM_BOT_TOKEN to the public browser. Enforces authentication.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getTelegramFileStream } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyMediaToken } from "@/lib/jwt";
import { apiError } from "@/lib/api";

export async function GET(request: Request) {
  try {
    // ── Guard: Authenticate user ─────────────────────────────────────────
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const id = searchParams.get("id");

    if (!token && !id) {
      return NextResponse.json(
        { error: "Missing token or id parameter." },
        { status: 400 }
      );
    }

    let fileIdToStream: string | null = null;

    if (token) {
      // ── Access via short-lived JWT (temporary media) ──────────────
      const payload = await verifyMediaToken(token);
      if (!payload) {
        return NextResponse.json({ error: "Invalid or expired token." }, { status: 403 });
      }
      
      if (payload.userId !== currentUser.id) {
        return NextResponse.json({ error: "Token does not belong to you." }, { status: 403 });
      }
      
      fileIdToStream = payload.fileId;
      
    } else if (id) {
      // ── Access via persistent Library Asset ID ────────────────────
      const { data: asset } = await supabaseAdmin
        .from("library_assets")
        .select("telegram_file_id")
        .eq("id", id)
        .eq("user_id", currentUser.id)
        .single();

      if (!asset || !asset.telegram_file_id) {
        return NextResponse.json({ error: "Asset not found or access denied." }, { status: 404 });
      }

      fileIdToStream = asset.telegram_file_id;
    }

    // Telegram file_ids are opaque ASCII tokens (Base64URL-ish, often 60-120
    // chars, may include '=' padding). Reject only obvious garbage rather than
    // risk rejecting a legitimate id via an over-tight regex. Fixes L4.
    if (
      !fileIdToStream ||
      fileIdToStream.length < 10 ||
      fileIdToStream.length > 512 ||
      !/^[\w.+=-]+$/.test(fileIdToStream)
    ) {
      return NextResponse.json({ error: "Invalid file reference." }, { status: 400 });
    }

    const { stream, mimeType, size } = await getTelegramFileStream(fileIdToStream);

    // Cache policy: token-served media is per-user and short-lived, so it must
    // never land in a shared/intermediary cache. The id-served path is keyed by
    // an unguessable UUID and owned-rows-only, so private short caching is fine.
    // Fixes M4 (was: public, immutable, 1 year).
    const cacheControl = token ? "private, no-store" : "private, max-age=300";

    return new Response(stream as any, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": size.toString(),
        "Cache-Control": cacheControl,
      },
    });
  } catch (err) {
    return apiError(err, "Failed to retrieve media from cloud storage.", 500);
  }
}
