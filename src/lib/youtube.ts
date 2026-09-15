import { google } from "googleapis";
import type { GoogleOAuth2Client } from "@/lib/google";

/**
 * Parses an ISO 8601 duration into seconds.
 *
 * YouTube returns days for long livestreams (e.g. `P1DT2H3M4S`); the weeks form
 * is legal in the spec too. Handling only `PT…` silently reported those as 0.
 */
export function parseDuration(duration: string): number {
  const match = duration
    .trim()
    .match(
      /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
    );
  if (!match) return 0;

  const [, weeks, days, hours, minutes, seconds] = match;
  return (
    Number(weeks || 0) * 604800 +
    Number(days || 0) * 86400 +
    Number(hours || 0) * 3600 +
    Number(minutes || 0) * 60 +
    Math.round(Number(seconds || 0))
  );
}

export default parseDuration;

/** Accepts a full playlist URL, a `list=` query fragment, or a bare ID. */
export function resolvePlaylistId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const listId = new URL(trimmed).searchParams.get("list");
    if (listId) return listId;
  } catch {
    // Not a URL; fall through to the regex and bare-ID cases.
  }

  const match = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (match?.[1]) return match[1];

  return trimmed;
}

export type PlaylistSummary = {
  playlistId: string;
  title: string | null;
  itemCount: number;
  countedCount: number;
  /** Items present in the playlist that returned no video — deleted or private. */
  unavailableCount: number;
  totalSeconds: number;
  averageSeconds: number;
  longest: { videoId: string; title: string; seconds: number } | null;
};

export type PlaylistOption = {
  id: string;
  title: string;
  itemCount: number;
  privacy: string;
  thumbnail: string | null;
};

/** The signed-in user's own playlists, private ones included. */
export async function listMyPlaylists(
  auth: GoogleOAuth2Client,
): Promise<PlaylistOption[]> {
  const youtube = google.youtube({ version: "v3", auth });
  const playlists: PlaylistOption[] = [];
  let pageToken: string | undefined;

  do {
    const response = await youtube.playlists.list({
      part: ["snippet", "contentDetails", "status"],
      mine: true,
      maxResults: 50,
      pageToken,
    });

    for (const item of response.data.items ?? []) {
      if (!item.id) continue;
      playlists.push({
        id: item.id,
        title: item.snippet?.title ?? "Untitled playlist",
        itemCount: item.contentDetails?.itemCount ?? 0,
        privacy: item.status?.privacyStatus ?? "unknown",
        thumbnail: item.snippet?.thumbnails?.medium?.url ?? null,
      });
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return playlists;
}

export async function fetchPlaylistSummary(
  auth: GoogleOAuth2Client | string,
  playlistId: string,
  skip = 0,
): Promise<PlaylistSummary> {
  const youtube = google.youtube({ version: "v3", auth });

  let title: string | null = null;
  try {
    const meta = await youtube.playlists.list({
      part: ["snippet"],
      id: [playlistId],
    });
    title = meta.data.items?.[0]?.snippet?.title ?? null;
  } catch {
    // Metadata is a nicety; a failure here shouldn't sink the duration.
  }

  const videoIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const response = await youtube.playlistItems.list({
      part: ["contentDetails"],
      playlistId,
      maxResults: 50,
      pageToken,
    });

    for (const item of response.data.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id) videoIds.push(id);
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  const selected = skip > 0 ? videoIds.slice(skip) : videoIds;

  let totalSeconds = 0;
  let countedCount = 0;
  let longest: PlaylistSummary["longest"] = null;

  for (let i = 0; i < selected.length; i += 50) {
    const chunk = selected.slice(i, i + 50);
    const response = await youtube.videos.list({
      part: ["contentDetails", "snippet"],
      id: chunk,
    });

    for (const item of response.data.items ?? []) {
      const seconds = parseDuration(item.contentDetails?.duration ?? "");
      totalSeconds += seconds;
      countedCount += 1;

      if (!longest || seconds > longest.seconds) {
        longest = {
          videoId: item.id ?? "",
          title: item.snippet?.title ?? "Untitled",
          seconds,
        };
      }
    }
  }

  return {
    playlistId,
    title,
    itemCount: selected.length,
    countedCount,
    // videos.list simply omits deleted and private entries, so the shortfall is
    // the count of things the total can't include.
    unavailableCount: Math.max(0, selected.length - countedCount),
    totalSeconds,
    averageSeconds: countedCount > 0 ? Math.round(totalSeconds / countedCount) : 0,
    longest,
  };
}
