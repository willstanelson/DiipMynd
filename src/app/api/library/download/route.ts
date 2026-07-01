// ============================================================================
// DiipMynd — Library Storage Downloader API
// POST /api/library/download
//
// Downloads a file from Fal.ai CDN. Pushes it to Telegram if bot credentials
// are present, or falls back to writing directly to the server's disk
// ('public/library/'). Returns the final localized URL.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isTelegramStorageEnabled, uploadUrlToTelegram } from "@/lib/telegram";
import { createMediaToken } from "@/lib/jwt";
import { safeFetchToBuffer, validateFetchUrl, SafeFetchError } from "@/lib/safeFetch";
import { apiError } from "@/lib/api";
import fs from "fs/promises";
import path from "path";

export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // 2. Parse body parameters
    const body = await request.json().catch(() => ({}));
    const { url, name } = body;

    if (!url || !name) {
      return NextResponse.json(
        { error: "Missing required parameters: url and name are required." },
        { status: 400 }
      );
    }

    // SSRF Guard: validate scheme + host allowlist via the shared helper.
    try {
      validateFetchUrl(url);
    } catch (err) {
      const msg = err instanceof SafeFetchError ? err.message : "Invalid target URL.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // 3. Sanitize filename and enforce unique timestamp
    const extension = name.includes(".") ? name.split(".").pop() || "" : "dat";
    const baseName = name.split(".")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
    const sanitizedName = `${baseName}_${Date.now()}.${extension}`;

    // 4. Route to optimal storage engine
    if (isTelegramStorageEnabled()) {
      try {
        console.log(`[download-api] Uploading to Telegram channel: ${sanitizedName}`);
        const result = await uploadUrlToTelegram(url, sanitizedName);
        const token = await createMediaToken(currentUser.id, result.fileId);
        const proxiedUrl = `/api/library/media?token=${token}`;
        
        return NextResponse.json({
          success: true,
          url: proxiedUrl,
          storage: "telegram",
          fileName: sanitizedName,
          telegramChatId: result.chatId,
          telegramMessageId: result.messageId,
        });
      } catch (err: any) {
        console.error(
          `[download-api] Telegram upload failed (${err.message}), falling back to local server disk...`
        );
      }
    }

    // 5. Fallback: Save locally in public/library/ (size-capped, SSRF-safe).
    console.log(`[download-api] Saving file to local disk: ${sanitizedName}`);
    const localLibraryDir = path.join(process.cwd(), "public", "library");
    await fs.mkdir(localLibraryDir, { recursive: true });

    const { buffer } = await safeFetchToBuffer(url, { maxBytes: 50 * 1024 * 1024 });
    const localFilePath = path.join(localLibraryDir, sanitizedName);

    await fs.writeFile(localFilePath, buffer);
    const localUrl = `/library/${sanitizedName}`;

    return NextResponse.json({
      success: true,
      url: localUrl,
      storage: "local",
      fileName: sanitizedName,
    });
  } catch (err: any) {
    if (err instanceof SafeFetchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return apiError(err, "Failed to download and store asset.", 500);
  }
}
