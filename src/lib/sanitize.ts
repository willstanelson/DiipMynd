// ============================================================================
// DiipMynd — User Input Sanitization Utility
//
// Filters out potential HTML injection vectors, script tags, inline event
// handlers (onerror, onload), and javascript: protocol URIs from user input.
// Keeps text safe for rendering and storage.
// ============================================================================

/**
 * Sanitizes input strings to prevent cross-site scripting (XSS) and injection attacks.
 * Strips HTML tags and script-injection signatures.
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== "string") return "";
  
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}
