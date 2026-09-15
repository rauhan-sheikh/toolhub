import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { EncryptJWT, jwtDecrypt } from "jose";
import { requireEnv } from "@/lib/env";

export const SESSION_COOKIE = "toolhub_session";

/** Short-lived CSRF nonce cookie, set before the redirect to Google. */
export const OAUTH_STATE_COOKIE = "toolhub_oauth_state";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type Session = {
  email: string;
  /**
   * Google refresh token. Long-lived, so the cookie is encrypted (JWE) rather
   * than merely signed — a signed JWT would leave this readable by anyone with
   * the cookie.
   */
  refreshToken: string;
};

/** Derives a 32-byte A256GCM key from SESSION_SECRET. */
function key(): Uint8Array {
  const secret = requireEnv("SESSION_SECRET");
  if (secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32",
    );
  }
  return new Uint8Array(createHash("sha256").update(secret).digest());
}

export async function encryptSession(session: Session): Promise<string> {
  return new EncryptJWT({
    email: session.email,
    refreshToken: session.refreshToken,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .encrypt(key());
}

export async function decryptSession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtDecrypt(token, key());
    const email = payload.email;
    const refreshToken = payload.refreshToken;
    if (typeof email !== "string" || typeof refreshToken !== "string") {
      return null;
    }
    return { email, refreshToken };
  } catch {
    // Tampered, expired, or encrypted under a rotated secret.
    return null;
  }
}

/** Returns the current session, or null when signed out. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decryptSession(token);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
} as const;

/** Only callable from a Route Handler or Server Function. */
export async function setSession(session: Session): Promise<void> {
  const token = await encryptSession(session);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
