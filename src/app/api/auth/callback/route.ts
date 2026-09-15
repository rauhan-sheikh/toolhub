import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl, allowedEmails } from "@/lib/env";
import { exchangeCode } from "@/lib/google";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  encryptSession,
  sessionCookieOptions,
} from "@/lib/session";

function failure(reason: string) {
  const url = new URL(`${appUrl()}/login`);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

/** Only allow relative paths, so `state` can't be used as an open redirect. */
function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  if (params.get("error")) {
    return failure("access_denied");
  }

  const code = params.get("code");
  const rawState = params.get("state");
  if (!code || !rawState) {
    return failure("missing_code");
  }

  // CSRF: the nonce in `state` must match the one we set before the redirect.
  const expectedNonce = (await cookies()).get(OAUTH_STATE_COOKIE)?.value;

  let state: { nonce?: string; next?: string };
  try {
    state = JSON.parse(Buffer.from(rawState, "base64url").toString("utf8"));
  } catch {
    return failure("bad_state");
  }

  if (!expectedNonce || !state.nonce || state.nonce !== expectedNonce) {
    return failure("bad_state");
  }

  let email: string;
  let refreshToken: string;
  try {
    ({ email, refreshToken } = await exchangeCode(code));
  } catch (error) {
    console.error("OAuth code exchange failed:", error);
    return failure("exchange_failed");
  }

  if (!allowedEmails().includes(email)) {
    return failure("not_allowed");
  }

  const response = NextResponse.redirect(
    new URL(safeNext(state.next), appUrl()),
  );
  // Set on the response directly rather than via cookies(), so the Set-Cookie
  // header is unambiguously attached to this redirect.
  response.cookies.set(
    SESSION_COOKIE,
    await encryptSession({ email, refreshToken }),
    sessionCookieOptions,
  );
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
