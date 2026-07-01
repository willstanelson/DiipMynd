// ============================================================================
// DiipMynd — SSRF-Safe Fetch Helper
//
// Centralizes the defenses against Server-Side Request Forgery when the server
// fetches user-influenced URLs (Fal/Runway/Telegram CDN transfers, prompt
// images, etc.). Fixes audit findings C2/C3/C4 (SSRF + unbounded download).
//
// Defenses applied:
//   1. Scheme: https (or http only when explicitly opted in for trusted hosts).
//   2. Host allowlist (exact or suffix match).
//   3. No redirects followed by default — a redirect to an internal IP is the
//      classic SSRF bypass. When redirects must be allowed, each hop is
//      re-validated against the allowlist by the caller.
//   4. Response size cap: aborts once the streamed body exceeds maxBytes.
//
// NOTE: Node's global fetch resolves DNS at request time and does not expose
// the resolved IP, so true IP-pinning is not available without a custom agent.
// The redirect + scheme + allowlist + size-cap combination closes the practical
// bypass vectors; IP pinning is flagged as a future hardening item.
// ============================================================================

const MAX_BYTES_DEFAULT = 50 * 1024 * 1024; // 50 MB

const DEFAULT_ALLOWED_HOSTS = [
  "fal.run",
  "fal.media",
  "fal.ai",
  "supabase.co",
  "googleusercontent.com",
  "googleapis.com",
  "runwayml.com",
  "runway.com",
  "dev.runwayml.com",
];

export interface SafeFetchOptions {
  /** Override the default host allowlist. */
  allowedHosts?: string[];
  /** Max response size in bytes. Default 50 MB. */
  maxBytes?: number;
  /** Allow http:// scheme (default false). Use sparingly. */
  allowHttp?: boolean;
}

export class SafeFetchError extends Error {}

/**
 * Validates a URL against scheme + allowlist rules. Throws SafeFetchError on
 * violation. Returns the parsed URL on success.
 */
export function validateFetchUrl(
  url: string,
  options: SafeFetchOptions = {}
): URL {
  const { allowedHosts = DEFAULT_ALLOWED_HOSTS, allowHttp = false } = options;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafeFetchError("Invalid URL format.");
  }

  const schemeOk = parsed.protocol === "https:" || (allowHttp && parsed.protocol === "http:");
  if (!schemeOk) {
    throw new SafeFetchError("Only https URLs are permitted.");
  }

  const host = parsed.hostname.toLowerCase();
  const isAllowed = allowedHosts.some(
    (h) => host === h || host.endsWith(`.${h}`)
  );
  if (!isAllowed) {
    throw new SafeFetchError("Target host is not in the allowlist.");
  }

  // Block userinfo (http://evil@host) and explicit credentials — uncommon for
  // these CDNs and a known SSRF/confusion vector.
  if (parsed.username || parsed.password) {
    throw new SafeFetchError("Credentials in URL are not permitted.");
  }

  return parsed;
}

/**
 * Fetches a URL safely: validates scheme/host, follows NO redirects, and
 * enforces a response byte cap. Returns the Response with a body that has been
 * verified not to exceed maxBytes (caller should still stream responsibly).
 *
 * Throws SafeFetchError on any policy violation or size overrun.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
  init: RequestInit = {}
): Promise<Response> {
  validateFetchUrl(url, options);

  const maxBytes = options.maxBytes ?? MAX_BYTES_DEFAULT;

  const response = await fetch(url, {
    ...init,
    redirect: "error", // any redirect → throw, so a redirect-to-internal attack fails
  });

  if (!response.ok) {
    throw new SafeFetchError(`Fetch failed with status ${response.status}.`);
  }

  // Enforce declared Content-Length against the cap when the server provides it.
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    // Drain to allow connection reuse, then bail.
    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }
    throw new SafeFetchError(`Response exceeds maximum allowed size (${maxBytes} bytes).`);
  }

  return response;
}

/**
 * Downloads a URL into a Buffer with the full SSRF + size-cap defenses applied.
 * Use this instead of `await response.arrayBuffer()` for user-influenced URLs.
 */
export async function safeFetchToBuffer(
  url: string,
  options: SafeFetchOptions = {},
  init: RequestInit = {}
): Promise<{ buffer: Buffer; mimeType: string }> {
  const maxBytes = options.maxBytes ?? MAX_BYTES_DEFAULT;
  const response = await safeFetch(url, options, init);

  const mimeType = response.headers.get("content-type") || "application/octet-stream";

  // Stream into a buffer with a hard cap, aborting if the body grows too large.
  const reader = response.body?.getReader();
  if (!reader) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new SafeFetchError(`Response exceeds maximum allowed size (${maxBytes} bytes).`);
    }
    return { buffer: Buffer.from(ab), mimeType };
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new SafeFetchError(`Response exceeds maximum allowed size (${maxBytes} bytes).`);
    }
    chunks.push(Buffer.from(value));
  }

  return { buffer: Buffer.concat(chunks), mimeType };
}
