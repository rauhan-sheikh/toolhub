import "server-only";

import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { appUrl, requireEnv } from "@/lib/env";

/**
 * Google OAuth over plain `fetch`.
 *
 * This used to go through `googleapis`, which eagerly loads all ~300 Google API
 * clients (≈200 MB on disk) to make the four HTTP calls this app needs. The
 * endpoints below are stable, documented REST, and `jose` — already here for
 * the session cookie — verifies the id_token.
 */

/**
 * One OAuth client does both jobs: `openid`/`email` identifies the user for the
 * app gate, `youtube.readonly` reads their playlists — private ones included,
 * which a bare API key can never do.
 */
export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/youtube.readonly",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// Module-level so jose's key cache survives between sign-ins.
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

/**
 * Carries the same `code` / `errors[].reason` shape googleapis used to throw,
 * so `errorResponse` in `@/lib/api` maps failures without knowing the source.
 */
export class GoogleApiError extends Error {
  code: number;
  errors?: { reason?: string; message?: string }[];

  constructor(
    code: number,
    message: string,
    errors?: { reason?: string; message?: string }[],
  ) {
    super(message);
    this.name = "GoogleApiError";
    this.code = code;
    this.errors = errors;
  }
}

/** Credentials for a YouTube Data API call: the user's, or the public-only key. */
export type YouTubeAuth = { accessToken: string } | { apiKey: string };

export function redirectUri(): string {
  return `${appUrl()}/api/auth/callback`;
}

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Forces Google to re-issue a refresh token. Without it, a second sign-in
    // returns only an access token and the session would have nothing to store.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  params: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      ...params,
    }),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || data.error) {
    // invalid_grant means the refresh token was revoked or expired — the
    // user has to sign in again, which is exactly what a 401 tells them.
    const code = data.error === "invalid_grant" ? 401 : response.status || 500;
    throw new GoogleApiError(
      code,
      data.error_description ?? data.error ?? `Token endpoint returned ${response.status}`,
    );
  }
  return data;
}

export type ExchangeResult = {
  email: string;
  refreshToken: string;
};

/** Exchanges an authorization code for a refresh token and verified email. */
export async function exchangeCode(code: string): Promise<ExchangeResult> {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app's access at " +
        "myaccount.google.com/permissions and sign in again.",
    );
  }
  if (!tokens.id_token) {
    throw new Error("Google did not return an id_token.");
  }

  const { payload } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: requireEnv("GOOGLE_CLIENT_ID"),
  });

  const email = payload.email;
  if (typeof email !== "string" || !email) {
    throw new Error("Google id_token contained no email claim.");
  }
  if (payload.email_verified !== true) {
    throw new Error("Google reports this email address as unverified.");
  }

  if (tokens.access_token && tokens.expires_in) {
    remember(tokens.refresh_token, tokens.access_token, tokens.expires_in);
  }

  return { email: email.toLowerCase(), refreshToken: tokens.refresh_token };
}

/**
 * Access tokens live an hour; minting one per request would add a round trip
 * to Google in front of every YouTube call. Keyed by a hash so the refresh
 * token itself never sits in a long-lived structure.
 */
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

function cacheKey(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("base64url");
}

function remember(refreshToken: string, token: string, expiresIn: number) {
  // Expire a minute early so a token never dies mid-request.
  const expiresAt = Date.now() + (expiresIn - 60) * 1000;
  accessTokens.set(cacheKey(refreshToken), { token, expiresAt });

  // A handful of sessions at most, but don't let dead entries accumulate.
  for (const [key, entry] of accessTokens) {
    if (entry.expiresAt <= Date.now()) accessTokens.delete(key);
  }
}

/** A current access token for the session's refresh token, cached until near expiry. */
export async function accessToken(refreshToken: string): Promise<string> {
  const cached = accessTokens.get(cacheKey(refreshToken));
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const tokens = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (!tokens.access_token) {
    throw new GoogleApiError(401, "Google did not return an access token.");
  }

  remember(refreshToken, tokens.access_token, tokens.expires_in ?? 3600);
  return tokens.access_token;
}
