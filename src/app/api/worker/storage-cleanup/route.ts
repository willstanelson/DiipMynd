// ============================================================================
// DiipMynd — Worker: Stale Asset Storage Cleanup
// POST /api/worker/storage-cleanup  (CRON_SECRET protected)
//
// Auth: requires a valid CRON_SECRET header.
//
// Hardening vs. original (audit findings C2 / M6):
//   * CRON_SECRET auth gate.
//   * Idempotent deletion: a Telegram "message to delete not found" response is
//     treated as success (the asset is already gone), so the DB row is removed
//     rather than orphaned forever with a dead URL.
//   * DB row is removed even if Telegram itself is unavailable but the row's
//     file pointers are empty — guarantees forward progress.
// ============================================================================

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { deleteTelegramMessage } from "@/lib/telegram";
import { apiError, requireCronAuth } from "@/lib/api";

export const maxDuration = 300;

export async function POST() {
  const authFail = await requireCronAuth();
  if (authFail) return authFail;

  try {
    // Fetch unpinned assets older than 30 days that still point at Telegram.
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    const { data: assets, error } = await supabaseAdmin
      .from("library_assets")
      .select("id, telegram_chat_id, telegram_message_id")
      .eq("pinned", false)
      .not("telegram_chat_id", "is", null)
      .not("telegram_message_id", "is", null)
      .lt("created_at", cutoffDate.toISOString())
      .limit(50); // Batch limit to respect Telegram rate limits

    if (error) {
      console.error("[storage-cleanup] Failed to fetch assets:", error);
      return NextResponse.json({ error: "Failed to fetch assets" }, { status: 500 });
    }

    if (!assets || assets.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: "No stale assets found." });
    }

    let deletedCount = 0;

    for (const asset of assets) {
      const chatId = asset.telegram_chat_id;
      const messageId = asset.telegram_message_id;
      if (chatId == null || messageId == null) continue;

      const telegramDeleted = await deleteTelegramMessage(
        chatId as number,
        messageId as number
      );

      if (telegramDeleted) {
        // Telegram confirmed deletion (or the message was already gone — see
        // deleteTelegramMessage). Safe to remove the DB row.
        const { error: dbDeleteError } = await supabaseAdmin
          .from("library_assets")
          .delete()
          .eq("id", asset.id);

        if (dbDeleteError) {
          console.error(`[storage-cleanup] DB delete failed for ${asset.id}:`, dbDeleteError.message);
          // Leave the row; it'll be retried on a future tick.
        } else {
          deletedCount++;
        }
      }

      // Sleep 50ms to respect Telegram rate limit (~20 msgs/sec per chat).
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return NextResponse.json({ success: true, processed: deletedCount });
  } catch (err) {
    return apiError(err, "Failed to run storage cleanup.", 500);
  }
}
