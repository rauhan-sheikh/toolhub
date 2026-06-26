import { google } from "googleapis";
import { NextResponse } from "next/server";
import parseDuration from "@/lib/youtube";

const apiKey = process.env.YOUTUBE_API_KEY;

const youtube = google.youtube({
  version: "v3",
  auth: apiKey,
});

function resolvePlaylistId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const listId = url.searchParams.get("list");
    if (listId) return listId;
  } catch {
    // not a valid URL, fall back to regex extraction
  }

  const match = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (match?.[1]) return match[1];

  return trimmed;
}

export async function POST(req: Request) {
  try {
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing YOUTUBE_API_KEY environment variable" },
        { status: 500 },
      );
    }

    const body = await req.json();
    const rawInput = String(body?.playlistId ?? "");
    const playlistId = resolvePlaylistId(rawInput);
    const skip = Number(body?.skip ?? 0);

    if (!playlistId) {
      return NextResponse.json(
        { error: "Playlist URL or ID is required" },
        { status: 400 },
      );
    }

    let nextPageToken: string | undefined;
    const videoIds: string[] = [];

    do {
      const response = await youtube.playlistItems.list({
        part: ["contentDetails"],
        playlistId,
        maxResults: 50,
        pageToken: nextPageToken,
      });

      response.data.items?.forEach((item) => {
        const id = item.contentDetails?.videoId;
        if (id) videoIds.push(id);
      });

      nextPageToken = response.data.nextPageToken ?? undefined;
    } while (nextPageToken);

    const filteredIds = videoIds.slice(skip);
    let totalSeconds = 0;

    for (let i = 0; i < filteredIds.length; i += 50) {
      const chunk = filteredIds.slice(i, i + 50);

      const response = await youtube.videos.list({
        part: ["contentDetails"],
        id: chunk,
      });

      response.data.items?.forEach((item) => {
        const duration = item.contentDetails?.duration || "";
        totalSeconds += parseDuration(duration);
      });
    }

    return NextResponse.json({ totalSeconds });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Something went wrong";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
