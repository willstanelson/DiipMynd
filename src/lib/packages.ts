// ============================================================================
// DiipMynd — Shared Pricing Packages & Blockchain Constants
//
// Centralized configuration for pricing bundles, credits, fiat payment gateways,
// cryptocurrency contract/wallet definitions, and unified AI model mappings.
// ============================================================================

export interface PricingPackage {
  id: string;
  name: string;
  credits: number;
  durationText: string;
  priceNGN: string;
  priceNGNKobo: number;
  priceUSD: string;
  priceUSDVal: number;
  popular?: boolean;
}

export const PACKAGES: PricingPackage[] = [
  {
    id: "trial",
    name: "Trial Bundle",
    credits: 600, // 10 minutes
    durationText: "10 minutes stream time",
    priceNGN: "₦49,500",
    priceNGNKobo: 4950000,
    priceUSD: "$33.00",
    priceUSDVal: 33.00,
  },
  {
    id: "starter",
    name: "Starter Bundle",
    credits: 1800, // 30 minutes
    durationText: "30 minutes stream time",
    priceNGN: "₦135,000",
    priceNGNKobo: 13500000,
    priceUSD: "$90.00",
    priceUSDVal: 90.00,
    popular: true,
  },
  {
    id: "standard",
    name: "Standard Bundle",
    credits: 3600, // 1 hour
    durationText: "1 hour stream time",
    priceNGN: "₦243,000",
    priceNGNKobo: 24300000,
    priceUSD: "$162.00",
    priceUSDVal: 162.00,
  },
  {
    id: "pro",
    name: "Pro Bundle",
    credits: 18000, // 5 hours
    durationText: "5 hours stream time",
    priceNGN: "₦1,080,000",
    priceNGNKobo: 108000000,
    priceUSD: "$720.00",
    priceUSDVal: 720.00,
  },
];

export const PACKAGE_CREDITS: Record<string, number> = {
  trial: 600,
  starter: 1800,
  standard: 3600,
  pro: 18000,
};

export const PACKAGE_PRICES_KOBO: Record<string, number> = {
  trial: 4950000,
  starter: 13500000,
  standard: 24300000,
  pro: 108000000,
};

export const PACKAGE_PRICES_USD: Record<string, number> = {
  trial: 33.00,
  starter: 90.00,
  standard: 162.00,
  pro: 720.00,
};

export const CRYPTO_WALLETS = {
  tron: {
    networkName: "TRON (TRC-20)",
    tokenName: "USDT (TRC-20)",
    address: "TPoYAxCNnPPZS6EarjrLGKDgiu3B8MGVyA",
    contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  },
  bsc: {
    networkName: "Binance Smart Chain (BSC - BEP-20)",
    tokenName: "USDT or USDC (BEP-20)",
    address: "0x467249EAC0FDeC3dB9aD2814eBACbd62253eDcFA",
    usdtContract: "0x55d398326f99059ff775485246999027b3197955",
    usdcContract: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  },
};

// ============================================================================
// Model Configuration Mappings
// ============================================================================

export interface ModelOption {
  id: string;
  name: string;
  endpoint: string;
  creditCost: number;
}

export const IMAGE_MODELS: ModelOption[] = [
  { id: "flux_2", name: "Flux.2 Pro", endpoint: "fal-ai/flux/pro", creditCost: 12 },
  { id: "nano_banana_2_pro", name: "Nano Banana 2/Pro", endpoint: "fal-ai/nano-banana-pro", creditCost: 5 },
  { id: "gpt_image_2", name: "GPT Image 2", endpoint: "openai/gpt-image-2", creditCost: 8 },
  { id: "recraft_v4", name: "Recraft v4", endpoint: "fal-ai/recraft-v3", creditCost: 8 },
  { id: "midjourney", name: "Playground v2.5 (Midjourney Alt)", endpoint: "fal-ai/playground-v25", creditCost: 5 },
];

export const VIDEO_MODELS: ModelOption[] = [
  { id: "kling_pro", name: "Kling 3.0 Pro", endpoint: "fal-ai/kling-video/v3/pro/text-to-video", creditCost: 30 },
  { id: "hunyuan_video", name: "Veo 3.1", endpoint: "fal-ai/veo3.1", creditCost: 25 },
  { id: "luma_dream", name: "Sora 2 Pro", endpoint: "fal-ai/sora-2/text-to-video/pro", creditCost: 35 },
  { id: "runway_gen_4_5", name: "Runway Gen 4.5 (Direct API)", endpoint: "runway-gen4.5", creditCost: 40 },
  { id: "cogvideox_5b", name: "Pika 2.5 (Pika v2.1)", endpoint: "fal-ai/pika/v2.1/text-to-video", creditCost: 25 },
];

export const AUDIO_MODELS: ModelOption[] = [
  { id: "kokoro", name: "Kokoro (Presets)", endpoint: "fal-ai/kokoro", creditCost: 2 },
  { id: "f5_tts", name: "F5-TTS (Voice Cloning)", endpoint: "fal-ai/f5-tts", creditCost: 10 },
  { id: "xtts_v2", name: "XTTS-v2 (Voice Cloning / Vozo Alt)", endpoint: "fal-ai/xtts-v2", creditCost: 10 },
  { id: "elevenlabs", name: "ElevenLabs TTS", endpoint: "fal-ai/elevenlabs/tts", creditCost: 15 },
  { id: "heygen", name: "HeyGen Talking Avatar", endpoint: "fal-ai/heygen/avatar-v/digital-twin", creditCost: 25 },
  { id: "synclabs", name: "Sync Labs LipSync", endpoint: "fal-ai/sync-lipsync/v2/pro", creditCost: 20 },
];
