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

    // SSRF Guard: Validate target URL host to prevent internal network scanning
    try {
      const parsedUrl = new URL(url);
      const allowedHosts = [
        "fal.run",
        "fal.media",
        "fal.ai",
        "supabase.co",
        "googleusercontent.com",
        "googleapis.com",
        "runwayml.com",
        "runway.com",
        "dev.runwayml.com",
      ];
      
      const isAllowed = allowedHosts.some(
        (host) => parsedUrl.hostname === host || parsedUrl.hostname.endsWith(`.${host}`)
      );
      
      if (!isAllowed) {
        return NextResponse.json(
          { error: "Forbidden target URL. Only media assets from trusted AI CDNs are allowed." },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid target URL format." },
        { status: 400 }
      );
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

    // 5. Fallback: Save locally in public/library/
    console.log(`[download-api] Saving file to local disk: ${sanitizedName}`);
    const localLibraryDir = path.join(process.cwd(), "public", "library");
    await fs.mkdir(localLibraryDir, { recursive: true });

    // Download from Fal.ai CDN
    const response = await fetch(url, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`SSRF Prevention: Redirects are not allowed. Status: ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch media from source CDN. Status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
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
    console.error("[download-api] Fatal download error:", err.message);
    return NextResponse.json(
      { error: err.message || "Failed to download and store asset." },
      { status: 500 }
    );
  }
}
