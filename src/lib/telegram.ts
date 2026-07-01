// ============================================================================
// DiipMynd — Telegram Cloud Storage Engine
//
// Handles downloading generated media from Fal.ai CDN URLs and posting them
// to a private Telegram Channel using the Telegram Bot API. Returns a persistent
// Telegram file_id to retrieve and stream the file securely.
// ============================================================================

import { Readable } from "stream";
import { safeFetchToBuffer } from "./safeFetch";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Helper to check if Telegram storage is enabled in environment variables.
 */
export function isTelegramStorageEnabled(): boolean {
  return (
    !!TELEGRAM_BOT_TOKEN &&
    !!TELEGRAM_CHAT_ID &&
    TELEGRAM_BOT_TOKEN !== "placeholder_bot_token" &&
    TELEGRAM_CHAT_ID !== "placeholder_chat_id"
  );
}

/**
 * Downloads a file from a URL and returns it as a Buffer.
 * Uses the SSRF-safe fetcher: scheme/host allowlist, no redirects, and a 50 MB
 * byte cap to prevent memory exhaustion. Fixes audit findings C4/M7.
 */
async function downloadFile(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  return safeFetchToBuffer(url, { maxBytes: 50 * 1024 * 1024 });
}

/**
 * Uploads a Buffer to Telegram as a document (preserving original format and up to 2GB size).
 * Returns the Telegram file_id.
 */
export async function uploadBufferToTelegram(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{ fileId: string; chatId: number; messageId: number }> {
  if (!isTelegramStorageEnabled()) {
    throw new Error("Telegram cloud storage is not configured in environment variables.");
  }

  // Create multipart/form-data boundary
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
  const headers = {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  };

  // Build multipart form body manually to avoid external FormData library dependencies in Node.js
  const chunks: Buffer[] = [];
  
  // Append chat_id
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="chat_id"\r\n\r\n`));
  chunks.push(Buffer.from(`${TELEGRAM_CHAT_ID}\r\n`));

  // Append document (the file)
  const safeFileName = fileName.replace(/["\r\n\\]/g, "_");
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(
    Buffer.from(
      `Content-Disposition: form-data; name="document"; filename="${safeFileName}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    )
  );
  chunks.push(buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(chunks);

  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
  const response = await fetch(telegramUrl, {
    method: "POST",
    headers,
    body,
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Failed to parse Telegram API response. Raw response: ${responseText}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram upload failed: ${data.description || "Unknown Telegram error"}`
    );
  }

  // Retrieve the file ID from the result
  const fileId = data.result?.document?.file_id;
  if (!fileId) {
    throw new Error("Telegram response did not return a valid file_id.");
  }

  return {
    fileId,
    chatId: data.result.chat.id,
    messageId: data.result.message_id,
  };
}

/**
 * Downloads a media asset from a Fal.ai CDN URL and uploads it directly to Telegram.
 * Returns the Telegram file_id.
 */
export async function uploadUrlToTelegram(url: string, fileName: string): Promise<{ fileId: string; chatId: number; messageId: number }> {
  console.log(`[telegram-storage] Transferring asset to Telegram: ${url}`);
  const { buffer, mimeType } = await downloadFile(url);
  const result = await uploadBufferToTelegram(buffer, fileName, mimeType);
  console.log(`[telegram-storage] Successfully uploaded to Telegram. File ID: ${result.fileId}`);
  return result;
}

/**
 * Gets the direct temporary download URL from Telegram for a given file_id.
 * This URL is retrieved on-the-fly and should not be exposed directly to the client browser.
 */
export async function getTelegramFileStream(fileId: string): Promise<{
  stream: Readable;
  mimeType: string;
  size: number;
}> {
  if (!isTelegramStorageEnabled()) {
    throw new Error("Telegram cloud storage is not configured.");
  }

  // 1. Get file path from Telegram
  const getFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  const getFileRes = await fetch(getFileUrl);
  if (!getFileRes.ok) {
    throw new Error(`Failed to get file details from Telegram. Status: ${getFileRes.status}`);
  }
  const getFileData = await getFileRes.json();
  if (!getFileData.ok || !getFileData.result?.file_path) {
    throw new Error(`Telegram getFile call failed: ${getFileData.description || "No path found"}`);
  }

  const filePath = getFileData.result.file_path;
  const fileSize = getFileData.result.file_size || 0;

  // 2. Fetch the actual file stream
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const downloadRes = await fetch(downloadUrl);
  if (!downloadRes.ok) {
    throw new Error(`Failed to stream file from Telegram CDN. Status: ${downloadRes.status}`);
  }

  // Infer Content Type
  const extension = filePath.split(".").pop()?.toLowerCase();
  let mimeType = "application/octet-stream";
  if (extension === "mp4") mimeType = "video/mp4";
  else if (extension === "png") mimeType = "image/png";
  else if (extension === "jpg" || extension === "jpeg") mimeType = "image/jpeg";
  else if (extension === "mp3") mimeType = "audio/mpeg";
  else if (extension === "wav") mimeType = "audio/wav";
  else if (extension === "txt") mimeType = "text/plain";
  else if (extension === "json") mimeType = "application/json";

  // Cast Next.js response body to Node Readable stream
  if (!downloadRes.body) {
    throw new Error("Telegram response body is empty.");
  }
  const stream = Readable.fromWeb(downloadRes.body as any);

  return {
    stream,
    mimeType,
    size: fileSize,
  };
}

/**
 * Deletes a message (media asset) from the Telegram channel.
 *
 * Idempotent: a Telegram "message to delete not found" error is treated as
 * success, because the desired end state (message gone) already holds. This
 * prevents the cleanup worker from leaving orphaned DB rows that reference a
 * message which was already removed. Fixes audit finding M6.
 */
export async function deleteTelegramMessage(chatId: number, messageId: number): Promise<boolean> {
  if (!isTelegramStorageEnabled()) {
    return false;
  }

  const deleteUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteMessage`;
  const response = await fetch(deleteUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
    }),
  });

  const data = await response.json().catch(() => null);

  if (response.ok && data?.ok === true) {
    return true;
  }

  // Already gone → idempotent success.
  const description: string = data?.description || "";
  const alreadyGone =
    response.status === 400 &&
    (description.toLowerCase().includes("message to delete not found") ||
      description.toLowerCase().includes("message not found"));

  if (alreadyGone) {
    return true;
  }

  console.error(
    `[telegram] Failed to delete message ${messageId} in chat ${chatId}: ${description || response.statusText}`
  );
  return false;
}
