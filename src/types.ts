// ============================================================================
// DiipMynd — Shared Type Definitions
// ============================================================================

/**
 * The two cloud AI providers supported by the Smart Router.
 */
export type Provider = "decart" | "fal";

/**
 * User's routing preference — "auto" lets the Smart Router decide.
 */
export type ProviderPreference = "auto" | "decart" | "fal";

/**
 * Represents every phase of the WebRTC connection lifecycle.
 * The UI renders different states based on this value.
 */
export type ConnectionState =
  | "idle"               // Initial state — nothing has started
  | "requesting-token"   // Fetching a short-lived client token from the backend
  | "initializing-camera"// Requesting webcam access via getUserMedia
  | "connecting"         // WebRTC handshake in progress with provider servers
  | "connected"          // Fully connected — AI-transformed stream is active
  | "reconnecting"       // Connection lost, automatic retry in progress
  | "disconnected"       // Cleanly disconnected (user-initiated or max retries)
  | "error";             // Unrecoverable error (e.g., camera permission denied)

/**
 * A preset transformation prompt for quick one-click selection.
 */
export interface PromptPreset {
  /** Unique key for React rendering */
  id: string;
  /** Display label on the chip */
  label: string;
  /** The prompt text sent to the AI provider */
  prompt: string;
  /** Emoji icon shown on the chip */
  icon: string;
}

/**
 * Error information for display in the UI.
 */
export interface StreamError {
  /** Machine-readable error code */
  code: "CAMERA_DENIED" | "CAMERA_NOT_FOUND" | "TOKEN_FAILED" | "CONNECTION_FAILED" | "UNKNOWN";
  /** Human-readable description */
  message: string;
}

/**
 * Response from the Decart token-minting endpoint (/api/decart-auth).
 */
export interface DecartAuthResponse {
  apiKey: string;
  expiresAt: number;
}

/**
 * Health check result for a single provider.
 */
export interface ProviderHealthStatus {
  available: boolean;
  latencyMs: number;
}

/**
 * Response from the /api/provider-health endpoint.
 */
export interface ProviderHealthResponse {
  decart: ProviderHealthStatus;
  fal: ProviderHealthStatus;
}
