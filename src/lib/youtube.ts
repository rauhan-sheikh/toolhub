import "server-only";

import { GoogleApiError, type YouTubeAuth } from "@/lib/google";

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
  longest: VideoRef | null;
  shortest: VideoRef | null;
};

export type VideoRef = { videoId: string; title: string; seconds: number };

export type PlaylistOption = {
  id: string;
  title: string;
  itemCount: number;
  privacy: string;
  thumbnail: string | null;
  /**
   * "liked" is YouTube's system Liked-videos playlist, which isn't returned by
   * playlists.list and has no item count.
   */
  kind: "owned" | "liked";
};

type Page<T> = { items?: T[]; nextPageToken?: string };

/**
 * One YouTube Data API v3 GET.
 *
 * Every call passes `fields`, so Google returns only what's read below —
 * `videos.list` with `snippet` otherwise ships each video's full description
 * and thumbnail set just so we can show a title.
 */
async function yt<T>(
  resource: string,
  params: Record<string, string | number | boolean | undefined>,
  auth: YouTubeAuth,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const headers: Record<string, string> = {};
  if ("apiKey" in auth) query.set("key", auth.apiKey);
  else headers.Authorization = `Bearer ${auth.accessToken}`;

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/${resource}?${query}`,
    { headers, cache: "no-store" },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: {
        code?: number;
        message?: string;
        errors?: { reason?: string; message?: string }[];
      };
    } | null;
    throw new GoogleApiError(
      body?.error?.code ?? response.status,
      body?.error?.message ?? `YouTube returned ${response.status}`,
      body?.error?.errors,
    );
  }

  return (await response.json()) as T;
}

/** The signed-in user's own playlists, private ones included. */
export async function listMyPlaylists(
  auth: YouTubeAuth,
): Promise<PlaylistOption[]> {
  const playlists: PlaylistOption[] = [];
  let pageToken: string | undefined;

  do {
    const response = await yt<
      Page<{
        id?: string;
        snippet?: { title?: string; thumbnails?: { medium?: { url?: string } } };
        contentDetails?: { itemCount?: number };
        status?: { privacyStatus?: string };
      }>
    >(
      "playlists",
      {
        part: "snippet,contentDetails,status",
        mine: true,
        maxResults: 50,
        pageToken,
        fields:
          "nextPageToken,items(id,snippet(title,thumbnails/medium/url),contentDetails/itemCount,status/privacyStatus)",
      },
      auth,
    );

    for (const item of response.items ?? []) {
      if (!item.id) continue;
      playlists.push({
        id: item.id,
        title: item.snippet?.title ?? "Untitled playlist",
        itemCount: item.contentDetails?.itemCount ?? 0,
        privacy: item.status?.privacyStatus ?? "unknown",
        thumbnail: item.snippet?.thumbnails?.medium?.url ?? null,
        kind: "owned",
      });
    }

    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);

  playlists.sort((a, b) => a.title.localeCompare(b.title));

  // Liked videos is a real, measurable playlist but playlists.list never
  // returns it — it only comes back as a related playlist on the channel.
  try {
    const channel = await yt<
      Page<{ contentDetails?: { relatedPlaylists?: { likes?: string } } }>
    >(
      "channels",
      {
        part: "contentDetails",
        mine: true,
        fields: "items/contentDetails/relatedPlaylists/likes",
      },
      auth,
    );
    const liked = channel.items?.[0]?.contentDetails?.relatedPlaylists?.likes;
    if (liked) {
      playlists.unshift({
        id: liked,
        title: "Liked videos",
        itemCount: 0,
        privacy: "private",
        thumbnail: null,
        kind: "liked",
      });
    }
  } catch {
    // Not fatal — the rest of the list is still useful.
  }

  return playlists;
}

export async function fetchPlaylistSummary(
  auth: YouTubeAuth,
  playlistId: string,
  skip = 0,
): Promise<PlaylistSummary> {
  let title: string | null = null;
  try {
    const meta = await yt<Page<{ snippet?: { title?: string } }>>(
      "playlists",
      { part: "snippet", id: playlistId, fields: "items/snippet/title" },
      auth,
    );
    title = meta.items?.[0]?.snippet?.title ?? null;
  } catch {
    // Metadata is a nicety; a failure here shouldn't sink the duration.
  }

  const videoIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const response = await yt<
      Page<{ contentDetails?: { videoId?: string } }>
    >(
      "playlistItems",
      {
        part: "contentDetails",
        playlistId,
        maxResults: 50,
        pageToken,
        fields: "nextPageToken,items/contentDetails/videoId",
      },
      auth,
    );

    for (const item of response.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id) videoIds.push(id);
    }

    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);

  const selected = skip > 0 ? videoIds.slice(skip) : videoIds;

  let totalSeconds = 0;
  let countedCount = 0;
  let longest: VideoRef | null = null;
  let shortest: VideoRef | null = null;

  for (let i = 0; i < selected.length; i += 50) {
    const chunk = selected.slice(i, i + 50);
    const response = await yt<
      Page<{
        id?: string;
        contentDetails?: { duration?: string };
        snippet?: { title?: string };
      }>
    >(
      "videos",
      {
        part: "contentDetails,snippet",
        id: chunk.join(","),
        fields: "items(id,contentDetails/duration,snippet/title)",
      },
      auth,
    );

    for (const item of response.items ?? []) {
      const seconds = parseDuration(item.contentDetails?.duration ?? "");
      totalSeconds += seconds;
      countedCount += 1;

      const ref: VideoRef = {
        videoId: item.id ?? "",
        title: item.snippet?.title ?? "Untitled",
        seconds,
      };

      if (!longest || seconds > longest.seconds) longest = ref;

      // Live and upcoming streams report a zero duration. Treating those as
      // "the shortest video" would be wrong every time one is present.
      if (seconds > 0 && (!shortest || seconds < shortest.seconds)) {
        shortest = ref;
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
    shortest,
  };
}
