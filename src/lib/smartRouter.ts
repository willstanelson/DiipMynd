// ============================================================================
// DiipMynd — Smart Router
//
// Client-side routing logic that decides which AI provider (Decart or Fal.ai)
// to use for each streaming session. Decision is based on:
//   1. User preference (manual override)
//   2. Network latency probing (lowest RTT wins)
//   3. Provider health / availability
//
// ============================================================================

import type {
  Provider,
  ProviderPreference,
  ProviderHealthResponse,
} from "@/types";

// ── Provider-specific configuration ────────────────────────────────────────

export interface ProviderConfig {
  provider: Provider;
  modelName: string;
  width: number;
  height: number;
  fps: number;
}

const DECART_CONFIG: ProviderConfig = {
  provider: "decart",
  modelName: "lucy-2.1",
  width: 1088,
  height: 624,
  fps: 30,
};

const FAL_CONFIG: ProviderConfig = {
  provider: "fal",
  modelName: "decart/lucy2-vton/realtime",
  width: 1088,
  height: 624,
  fps: 30,
};

/**
 * Returns the provider-specific configuration constants (model name,
 * resolution, FPS) for the chosen provider.
 */
export function getProviderConfig(provider: Provider): ProviderConfig {
  return provider === "decart" ? DECART_CONFIG : FAL_CONFIG;
}

/**
 * Selects the optimal provider based on user preference and provider health.
 *
 * Routing logic:
 * - If preference is "decart" or "fal" → use that directly (hard override).
 * - If preference is "auto" →
 *     1. Probe both providers via /api/provider-health
 *     2. Filter to those that are available
 *     3. Pick the one with lower latency
 *     4. If probing fails entirely, default to Decart (primary)
 */
export async function selectProvider(
  preference: ProviderPreference
): Promise<{ provider: Provider; reason: string }> {
  // Hard override — user explicitly chose a provider
  if (preference === "decart") {
    return { provider: "decart", reason: "User selected Decart" };
  }
  if (preference === "fal") {
    return { provider: "fal", reason: "User selected Fal.ai" };
  }

  // ── Auto mode: probe both providers ──────────────────────────────────
  try {
    const res = await fetch("/api/provider-health", {
      method: "GET",
      signal: AbortSignal.timeout(8000), // 8s max for the whole probe
    });

    if (!res.ok) {
      console.warn("[SmartRouter] Health endpoint returned non-OK, defaulting to Decart");
      return { provider: "decart", reason: "Health check unavailable — defaulting to primary" };
    }

    const health: ProviderHealthResponse = await res.json();

    const decartOk = health.decart.available;
    const falOk = health.fal.available;

    // Both available — pick lowest latency
    if (decartOk && falOk) {
      if (health.decart.latencyMs <= health.fal.latencyMs) {
        return {
          provider: "decart",
          reason: `Decart faster (${health.decart.latencyMs}ms vs ${health.fal.latencyMs}ms)`,
        };
      } else {
        return {
          provider: "fal",
          reason: `Fal.ai faster (${health.fal.latencyMs}ms vs ${health.decart.latencyMs}ms)`,
        };
      }
    }

    // Only one available
    if (decartOk) {
      return { provider: "decart", reason: "Fal.ai unavailable — using Decart" };
    }
    if (falOk) {
      return { provider: "fal", reason: "Decart unavailable — using Fal.ai" };
    }

    // Neither responded — fall through to default
    console.warn("[SmartRouter] Both providers report unavailable, defaulting to Decart");
    return { provider: "decart", reason: "Both probes failed — defaulting to primary" };
  } catch (err) {
    console.warn("[SmartRouter] Health probe failed:", err);
    return { provider: "decart", reason: "Probe network error — defaulting to primary" };
  }
}
