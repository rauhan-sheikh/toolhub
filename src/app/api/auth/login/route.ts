import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google";
import { OAUTH_STATE_COOKIE } from "@/lib/session";

export async function GET(request: Request) {
  const nextPath = new URL(request.url).searchParams.get("next");

  // CSRF guard: the nonce goes to Google in `state` and into a cookie here, and
  // the callback only proceeds if the two match.
  const nonce = randomUUID();
  // The post-login destination rides along inside `state` so the callback
  // needn't trust a query parameter an attacker could set.
  const state = Buffer.from(
    JSON.stringify({ nonce, next: nextPath ?? "/" }),
  ).toString("base64url");

  const response = NextResponse.redirect(getAuthUrl(state));
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
