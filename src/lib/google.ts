import "server-only";

import { google } from "googleapis";
import { appUrl, requireEnv } from "@/lib/env";

/**
 * Derived from googleapis rather than imported from google-auth-library:
 * googleapis-common nests its own copy of that package, and the two
 * `OAuth2Client` classes are nominally incompatible under TypeScript.
 */
export type GoogleOAuth2Client = InstanceType<typeof google.auth.OAuth2>;

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

export function redirectUri(): string {
  return `${appUrl()}/api/auth/callback`;
}

function client(): GoogleOAuth2Client {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri(),
  );
}

export function getAuthUrl(state: string): string {
  return client().generateAuthUrl({
    access_type: "offline",
    // Forces Google to re-issue a refresh token. Without it, a second sign-in
    // returns only an access token and the session would have nothing to store.
    prompt: "consent",
    scope: SCOPES,
    include_granted_scopes: true,
    state,
  });
}

export type ExchangeResult = {
  email: string;
  refreshToken: string;
};

/** Exchanges an authorization code for a refresh token and verified email. */
export async function exchangeCode(code: string): Promise<ExchangeResult> {
  const oauth = client();
  const { tokens } = await oauth.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app's access at " +
        "myaccount.google.com/permissions and sign in again.",
    );
  }
  if (!tokens.id_token) {
    throw new Error("Google did not return an id_token.");
  }

  const ticket = await oauth.verifyIdToken({
    idToken: tokens.id_token,
    audience: requireEnv("GOOGLE_CLIENT_ID"),
  });
  const email = ticket.getPayload()?.email;
  if (!email) {
    throw new Error("Google id_token contained no email claim.");
  }

  return { email: email.toLowerCase(), refreshToken: tokens.refresh_token };
}

/**
 * An OAuth client primed with the session's refresh token. googleapis mints and
 * refreshes access tokens from it on demand, so nothing else needs storing.
 */
export function authedClient(refreshToken: string): GoogleOAuth2Client {
  const oauth = client();
  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}
