import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { deleteTelegramMessage } from "@/lib/telegram";

export const maxDuration = 300;

export async function POST() {
  try {
    // Fetch unpinned assets > 30 days old
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
      if (asset.telegram_chat_id && asset.telegram_message_id) {
        // Delete from Telegram
        const telegramDeleted = await deleteTelegramMessage(asset.telegram_chat_id, asset.telegram_message_id);
        
        // Delete from DB only if Telegram deletion succeeded or if we don't care.
        // Actually, if it fails, we might want to retry later. If it succeeds, we delete from DB.
        if (telegramDeleted) {
           await supabaseAdmin.from("library_assets").delete().eq("id", asset.id);
           deletedCount++;
        }
        
        // Sleep 50ms to respect Telegram rate limit (approx 20 msgs/sec for same chat)
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    return NextResponse.json({ success: true, processed: deletedCount });
  } catch (err: any) {
    console.error("[storage-cleanup] Exception:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
