// ============================================================================
// DiipMynd — Workspace Library Database Helper
//
// Manages asset metadata tracking. Resolves queries to the Supabase
// 'library_assets' table. Removed insecure local JSON fallback logic.
// ============================================================================

import { supabaseAdmin } from "./supabase/server";
import crypto from "crypto";

export interface LibraryAsset {
  id: string;
  user_id: string;
  type: "video" | "image" | "audio" | "script";
  name: string;
  url: string; // Direct link (Telegram CDN or local url)
  model?: string;
  prompt?: string;
  pinned?: boolean;
  telegram_chat_id?: number | null;
  telegram_message_id?: number | null;
  telegram_file_id?: string | null;
  created_at: string;
}

/**
 * Fetches all library assets belonging to a specific user.
 */
export async function getUserAssets(userId: string): Promise<LibraryAsset[]> {
  const { data, error } = await supabaseAdmin
    .from("library_assets")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[library-db] Supabase query failed:", error.message);
    throw new Error(`Failed to retrieve library assets: ${error.message}`);
  }
  return (data || []) as LibraryAsset[];
}

/**
 * Adds a new generated asset to the workspace library database.
 */
export async function addAsset(
  assetData: Omit<LibraryAsset, "id" | "created_at">,
  providedId?: string
): Promise<LibraryAsset> {
  const newAsset: LibraryAsset = {
    id: providedId || crypto.randomUUID(),
    pinned: false,
    ...assetData,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("library_assets")
    .insert(newAsset)
    .select()
    .single();

  if (error) {
    console.error("[library-db] Supabase insert failed:", error.message);
    throw new Error(`Failed to save library asset: ${error.message}`);
  }
  return data as LibraryAsset;
}

/**
 * Removes a specific asset from the workspace library database.
 */
export async function deleteAsset(assetId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("library_assets")
    .delete()
    .eq("id", assetId)
    .eq("user_id", userId)
    .select();

  if (error) {
    console.error("[library-db] Supabase delete failed:", error.message);
    throw new Error(`Failed to delete library asset: ${error.message}`);
  }
  return data && data.length > 0;
}
