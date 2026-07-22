// ============================================================================
// DiipMynd — DB-backed App Settings
//
// A generic key/value store for operational config that needs to change
// without a Vercel redeploy — starting with the rotating test Decart API
// key. Falls back to an env var of the same name (upper-cased) if the DB
// has no row yet, so a fresh deploy still works out of the box.
//
// Cached in-memory for CACHE_TTL_MS to avoid a DB round trip on every
// stream/start call; the cache is per Lambda instance so a rotation can
// take up to CACHE_TTL_MS to propagate to warm instances.
// ============================================================================

import { supabaseAdmin } from "./supabase/server";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: string | null; expiresAt: number }>();

export async function getAppSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.error(`[appSettings] Failed to read '${key}':`, error.message);
    // Don't cache a read failure — retry on next call rather than freezing
    // in a bad state for CACHE_TTL_MS.
    return process.env[key.toUpperCase()] ?? null;
  }

  const value = data?.value ?? process.env[key.toUpperCase()] ?? null;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function setAppSetting(
  key: string,
  value: string,
  adminId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" }
    );

  if (error) {
    console.error(`[appSettings] Failed to write '${key}':`, error.message);
    return { ok: false, error: error.message };
  }

  cache.delete(key); // Force next read to pick up the new value immediately
  return { ok: true };
}
