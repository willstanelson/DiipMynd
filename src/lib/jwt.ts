// ============================================================================
// DiipMynd — JWT Utilities
//
// Generates and verifies short-lived JWTs for temporary access to media
// files stored in Telegram. Ensures that temporary `fileId` proxies are
// secure against enumeration and IDOR attacks.
// ============================================================================

import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.SUPABASE_JWT_SECRET || process.env.PAYSTACK_SECRET_KEY || "fallback_secret_for_dev_only_123"
);

export interface MediaTokenPayload {
  userId: string;
  fileId: string;
}

/**
 * Creates a short-lived token granting access to a specific Telegram file.
 */
export async function createMediaToken(userId: string, fileId: string): Promise<string> {
  const jwt = await new SignJWT({ userId, fileId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m") // 15 minute lifetime
    .sign(JWT_SECRET);
    
  return jwt;
}

/**
 * Verifies a media token and returns the payload if valid.
 */
export async function verifyMediaToken(token: string): Promise<MediaTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.userId || !payload.fileId) return null;
    
    return {
      userId: payload.userId as string,
      fileId: payload.fileId as string,
    };
  } catch (err) {
    return null;
  }
}
