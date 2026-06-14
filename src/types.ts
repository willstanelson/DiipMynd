// ============================================================================
// DiipMynd — Shared Type Definitions
// ============================================================================

/**
 * Represents every phase of the WebRTC connection lifecycle.
 * The UI renders different states based on this value.
 */
export type ConnectionState =
  | "idle"               // Initial state — nothing has started
  | "requesting-token"   // Fetching a short-lived client token from the backend
  | "initializing-camera"// Requesting webcam access via getUserMedia
  | "connecting"         // WebRTC handshake in progress with Decart servers
  | "connected"          // Fully connected — AI-transformed stream is active
  | "reconnecting"       // Connection lost, automatic retry in progress
  | "disconnected"       // Cleanly disconnected (user-initiated or max retries)
  | "error";             // Unrecoverable error (e.g., camera permission denied)

/**
 * Shape of the JSON response from /api/decart-auth.
 */
export interface DecartAuthResponse {
  /** The short-lived client token (ek_...) to use on the frontend */
  apiKey: string;
  /** ISO timestamp when the token expires */
  expiresAt: string;
}

/**
 * A preset transformation prompt for quick one-click selection.
 */
export interface PromptPreset {
  /** Unique key for React rendering */
  id: string;
  /** Display label on the chip */
  label: string;
  /** The prompt text sent to Decart */
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
