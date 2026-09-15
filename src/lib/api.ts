import "server-only";

import { NextResponse } from "next/server";
import { getSession, type Session } from "@/lib/session";

/**
 * Real authorization check, run inside each handler.
 *
 * Proxy only tests that a session cookie exists; this is what actually decrypts
 * and trusts it.
 */
export async function requireSession(): Promise<
  { ok: true; session: Session } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }
  return { ok: true, session };
}

type GoogleishError = {
  code?: number;
  status?: number;
  message?: string;
  errors?: { reason?: string; message?: string }[];
};

/** Turns googleapis/network failures into something worth showing a user. */
export function errorResponse(error: unknown): NextResponse {
  const err = (error ?? {}) as GoogleishError;
  const status = err.code ?? err.status ?? 500;
  const reason = err.errors?.[0]?.reason;

  if (reason === "playlistNotFound" || status === 404) {
    return NextResponse.json(
      {
        error:
          "Playlist not found. Private playlists only work if they belong to the signed-in account.",
      },
      { status: 404 },
    );
  }

  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    return NextResponse.json(
      { error: "YouTube API quota exhausted for today." },
      { status: 429 },
    );
  }

  if (status === 401 || reason === "authError") {
    return NextResponse.json(
      { error: "YouTube access expired. Sign out and back in." },
      { status: 401 },
    );
  }

  if (status === 403) {
    return NextResponse.json(
      { error: err.message ?? "YouTube refused the request." },
      { status: 403 },
    );
  }

  console.error("Unhandled API error:", error);
  return NextResponse.json(
    { error: err.message ?? "Something went wrong." },
    { status: typeof status === "number" && status >= 400 ? status : 500 },
  );
}
