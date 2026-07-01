// ============================================================================
// DiipMynd — JWT Utilities
//
// Generates and verifies short-lived JWTs for temporary access to media
// files stored in Telegram. Ensures that temporary `fileId` proxies are
// secure against enumeration and IDOR attacks.
//
// SECURITY: There is no fallback secret. If SUPABASE_JWT_SECRET is unset, the
// module throws at import time — refusing to start is strictly safer than
// signing tokens with a publicly-known string. Fixes audit finding C3.
// ============================================================================

import { SignJWT, jwtVerify } from "jose";

/**
 * Resolves the media-token signing secret. SECURITY: there is NO fallback — if
 * SUPABASE_JWT_SECRET is unset, every token operation throws rather than
 * signing/verifying with a public string. Fixes audit finding C3.
 *
 * Validation is lazy (at call time, not import time) so that environments
 * without the secret (e.g. a fresh CI build) can still build and serve routes
 * that don't touch media tokens. The fail-hard guarantee is preserved: you
 * cannot create or verify a media token without the secret.
 */
function getSecret(): Uint8Array {
  const raw = process.env.SUPABASE_JWT_SECRET;
  if (!raw) {
    throw new Error(
      "[jwt] SUPABASE_JWT_SECRET is not set. Refusing to sign/verify media tokens — " +
        "set SUPABASE_JWT_SECRET (your project's JWT secret) in the environment."
    );
  }
  return new TextEncoder().encode(raw);
}

const MEDIA_TOKEN_ISSUER = "diipmynd:media";
const MEDIA_TOKEN_AUDIENCE = "diipmynd:media";

export interface MediaTokenPayload {
  userId: string;
  fileId: string;
}

/**
 * Creates a short-lived token granting access to a specific Telegram file.
 */
export async function createMediaToken(userId: string, fileId: string): Promise<string> {
  const jwt = await new SignJWT({ userId, fileId, type: "media" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(MEDIA_TOKEN_ISSUER)
    .setAudience(MEDIA_TOKEN_AUDIENCE)
    .setExpirationTime("15m") // 15 minute lifetime
    .sign(getSecret());

  return jwt;
}

/**
 * Verifies a media token and returns the payload if valid.
 * Rejects tokens whose type or audience do not match, so a future token signed
 * with this key for another purpose cannot be replayed against media endpoints.
 */
export async function verifyMediaToken(token: string): Promise<MediaTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: MEDIA_TOKEN_ISSUER,
      audience: MEDIA_TOKEN_AUDIENCE,
    });

    if (payload.type !== "media" || !payload.userId || !payload.fileId) return null;

    return {
      userId: payload.userId as string,
      fileId: payload.fileId as string,
    };
  } catch {
    return null;
  }
}
