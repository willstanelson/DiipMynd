// ============================================================================
// DiipMynd — Binary File Uploader API
// POST /api/library/upload
//
// Receives multi-part file uploads (like reference audio clips for voice cloning).
// Uploads them to Telegram Bot storage, returning the secure proxied URL.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isTelegramStorageEnabled, uploadBufferToTelegram } from "@/lib/telegram";
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

    // 2. Parse FormData
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }

    // Enforce 10MB maximum upload size to prevent Out-Of-Memory issues
    const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds the 10MB limit. Uploaded file is ${(file.size / (1024 * 1024)).toFixed(2)}MB.` },
        { status: 413 } // 413 Payload Too Large
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name || "uploaded_asset.dat";
    const mimeType = file.type || "application/octet-stream";

    // 3. Sanitize filename
    const extension = fileName.includes(".") ? fileName.split(".").pop() || "" : "dat";
    const baseName = fileName.split(".")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
    const sanitizedName = `${baseName}_${Date.now()}.${extension}`;

    // 4. Route storage
    if (isTelegramStorageEnabled()) {
      try {
        console.log(`[upload-api] Routing file to Telegram bot CDN: ${sanitizedName}`);
        const result = await uploadBufferToTelegram(buffer, sanitizedName, mimeType);
        const token = await createMediaToken(currentUser.id, result.fileId);
        const proxiedUrl = `/api/library/media?token=${token}`;

        return NextResponse.json({
          success: true,
          url: proxiedUrl,
          storage: "telegram",
          telegramChatId: result.chatId,
          telegramMessageId: result.messageId,
        });
      } catch (err: any) {
        console.error(
          `[upload-api] Telegram upload failed (${err.message}), falling back to server local folder...`
        );
      }
    }

    // 5. Fallback: Save to public/library/
    console.log(`[upload-api] Saving uploaded file to local server disk: ${sanitizedName}`);
    const localDir = path.join(process.cwd(), "public", "library");
    await fs.mkdir(localDir, { recursive: true });

    const localFilePath = path.join(localDir, sanitizedName);
    await fs.writeFile(localFilePath, buffer);
    const localUrl = `/library/${sanitizedName}`;

    return NextResponse.json({
      success: true,
      url: localUrl,
      storage: "local",
    });
  } catch (err: any) {
    console.error("[upload-api] Fatal upload error:", err.message);
    return NextResponse.json(
      { error: err.message || "Failed to process and store uploaded file." },
      { status: 500 }
    );
  }
}

