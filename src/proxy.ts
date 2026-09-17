import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Proxy (Middleware's name since Next 16) runs in front of every route.
 *
 * This is an *optimistic* check only — it tests for the presence of the session
 * cookie and nothing more. Decrypting or validating here would run on every
 * prefetch; real authorization happens in each route handler, next to the data.
 */

const SESSION_COOKIE = "toolhub_session";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/callback",
  "/api/health",
  // Must stay reachable signed-out: Google fetches these while reviewing the
  // OAuth consent screen, and they're linked from the sign-in page.
  "/privacy",
  "/terms",
];

/**
 * Paths public at that exact address only. Kept apart from PUBLIC_PATHS
 * because the prefix match below would treat "/" as a prefix of every route
 * and silently unlock the entire app.
 */
const PUBLIC_EXACT_PATHS = ["/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true;
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  // Bouncing an API call to an HTML login page produces a confusing parse
  // error on the client, so answer those honestly instead.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL("/login", request.url);
  if (pathname !== "/") {
    url.searchParams.set("next", pathname);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except Next's static output and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
