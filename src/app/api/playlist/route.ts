import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { optionalEnv } from "@/lib/env";
import { accessToken } from "@/lib/google";
import { fetchPlaylistSummary, resolvePlaylistId } from "@/lib/youtube";

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const playlistId = resolvePlaylistId(String(body?.playlistId ?? ""));
    const skip = Number(body?.skip ?? 0);
    const safeSkip = Number.isFinite(skip) && skip > 0 ? skip : 0;

    if (!playlistId) {
      return NextResponse.json(
        { error: "Playlist URL or ID is required" },
        { status: 400 },
      );
    }

    // The user's OAuth credentials are what make private playlists readable; an
    // API key can only ever see public ones. The key stays as a fallback for
    // public playlists if OAuth is misconfigured.
    const apiKey = optionalEnv("YOUTUBE_API_KEY");
    let summary;
    try {
      summary = await fetchPlaylistSummary(
        { accessToken: await accessToken(auth.session.refreshToken) },
        playlistId,
        safeSkip,
      );
    } catch (oauthError) {
      if (!apiKey) throw oauthError;
      summary = await fetchPlaylistSummary({ apiKey }, playlistId, safeSkip);
    }

    return NextResponse.json(summary);
  } catch (error) {
    return errorResponse(error);
  }
}
