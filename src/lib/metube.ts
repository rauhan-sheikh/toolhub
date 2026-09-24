import "server-only";

import { optionalEnv } from "@/lib/env";

/**
 * Adapter over a MeTube instance, which is the yt-dlp engine behind the
 * downloader. Everything the UI needs goes through here, so swapping the engine
 * (or pointing at a different host) touches one file.
 *
 * MeTube is never exposed publicly — only this server talks to it.
 */

export type DownloadStatus =
  | "pending"
  | "downloading"
  | "preparing"
  | "finished"
  | "error"
  | "canceled";

export type DownloadItem = {
  id: string;
  url: string;
  title: string;
  status: DownloadStatus | string;
  /** 0–100, or null before yt-dlp reports progress. */
  percent: number | null;
  speed: number | null;
  eta: number | null;
  size: number | null;
  filename: string | null;
  msg: string | null;
  error: string | null;
  /** When it was queued, in epoch milliseconds. */
  timestamp: number | null;
  /** When the retention sweep removes a finished download, epoch ms. */
  expiresAt: number | null;
  /** Which MeTube collection it came from — determines how to delete it. */
  group: "queue" | "done" | "pending";
};

export type AddOptions = {
  url: string;
  downloadType?: "video" | "audio";
  quality?: string;
  format?: string;
  folder?: string;
  playlistItemLimit?: number;
};

/** Finished downloads — files and list entries — are deleted after this. */
export const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 86_400_000;

export function metubeUrl(): string | undefined {
  return optionalEnv("METUBE_URL")?.replace(/\/+$/, "");
}

export function isConfigured(): boolean {
  return Boolean(metubeUrl());
}

export class EngineOfflineError extends Error {
  constructor(message = "Download engine is unreachable.") {
    super(message);
    this.name = "EngineOfflineError";
  }
}

async function call<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<T> {
  const base = metubeUrl();
  if (!base) throw new EngineOfflineError("METUBE_URL is not configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `Engine returned ${response.status}: ${await response.text()}`,
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new EngineOfflineError("Download engine timed out.");
    }
    if (error instanceof TypeError) {
      // fetch throws TypeError on DNS/connection failure.
      throw new EngineOfflineError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type RawDownload = Record<string, unknown>;

/**
 * MeTube stamps entries with `time.time_ns()`; normalising by magnitude keeps
 * this right if a release ever switches to ms or seconds.
 */
function toEpochMs(value: number | null): number | null {
  if (value === null || value <= 0) return null;
  if (value > 1e17) return Math.round(value / 1e6); // nanoseconds
  if (value > 1e14) return Math.round(value / 1e3); // microseconds
  if (value > 1e11) return value; // milliseconds
  return value * 1000; // seconds
}

function normalize(raw: RawDownload, group: DownloadItem["group"]): DownloadItem {
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;

  const timestamp = toEpochMs(num(raw.timestamp));

  return {
    id: String(raw.id ?? raw.url ?? ""),
    url: String(raw.url ?? ""),
    title: str(raw.title) ?? String(raw.url ?? "Untitled"),
    status: str(raw.status) ?? "pending",
    percent: num(raw.percent),
    speed: num(raw.speed),
    eta: num(raw.eta),
    size: num(raw.size),
    filename: str(raw.filename),
    msg: str(raw.msg),
    error: str(raw.error),
    timestamp,
    expiresAt:
      group === "done" && timestamp !== null ? timestamp + RETENTION_MS : null,
    group,
  };
}

/**
 * MeTube's /history returns the whole live state, progress included, so polling
 * this is enough — no socket.io client or long-lived connection needed.
 */
export async function listDownloads(): Promise<DownloadItem[]> {
  const data = await call<{
    queue?: RawDownload[];
    done?: RawDownload[];
    pending?: RawDownload[];
  }>("/history");

  return [
    ...(data?.pending ?? []).map((item) => normalize(item, "pending")),
    ...(data?.queue ?? []).map((item) => normalize(item, "queue")),
    ...(data?.done ?? []).map((item) => normalize(item, "done")),
  ];
}

export async function addDownload(options: AddOptions): Promise<void> {
  const downloadType = options.downloadType ?? "video";

  await call("/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: options.url,
      download_type: downloadType,
      quality: options.quality ?? "best",
      format: options.format ?? (downloadType === "audio" ? "mp3" : "any"),
      folder: options.folder ?? "",
      auto_start: true,
      ...(options.playlistItemLimit
        ? { playlist_item_limit: options.playlistItemLimit }
        : {}),
    }),
  });
}

export async function deleteDownloads(
  ids: string[],
  where: "queue" | "done",
): Promise<void> {
  await call("/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, where }),
  });
}

export async function retryDownload(id: string): Promise<void> {
  await call("/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

/* ------------------------------------------------------------------ *
 * Finished files on disk
 *
 * MeTube writes into a volume this container also mounts, so the app can
 * hand the file to the browser and delete it without going through MeTube.
 * MeTube has no per-item "delete the file" API — only a global
 * DELETE_FILE_ON_TRASHCAN flag that would make every removal destructive.
 * ------------------------------------------------------------------ */

export function downloadsRoot(): string {
  return optionalEnv("DOWNLOADS_DIR") ?? "/downloads";
}

export class FileNotAvailableError extends Error {
  constructor(
    message: string,
    /** The path was fine; there is simply nothing there any more. */
    readonly missing = false,
  ) {
    super(message);
    this.name = "FileNotAvailableError";
  }
}

/**
 * Resolves a MeTube `filename` (relative to the download dir) to an absolute
 * path, refusing anything that escapes the root.
 *
 * The value originates from yt-dlp metadata — a video title becomes a
 * filename — so it is attacker-influenced and must never be trusted to stay
 * inside the directory on its own.
 */
export async function resolveDownloadPath(relative: string): Promise<string> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");

  const root = path.resolve(downloadsRoot());
  const target = path.resolve(root, relative);

  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new FileNotAvailableError("Refusing a path outside the download directory.");
  }

  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      throw new FileNotAvailableError("Not a file.");
    }
  } catch (error) {
    if (error instanceof FileNotAvailableError) throw error;
    throw new FileNotAvailableError(
      "That file is no longer on the server. It may have been cleared or moved.",
      true,
    );
  }

  return target;
}

/** Idempotent: a file that is already gone counts as deleted. */
export async function deleteDownloadedFile(relative: string): Promise<void> {
  const fs = await import("node:fs/promises");
  let target: string;
  try {
    target = await resolveDownloadPath(relative);
  } catch (error) {
    if (error instanceof FileNotAvailableError && error.missing) return;
    throw error;
  }
  await fs.unlink(target);
}

/**
 * When a file came to exist, as best the filesystem can say.
 *
 * Not mtime: yt-dlp can backdate it to the video's upload date, so a fresh
 * download would look years old. Birth time can't be set from userspace; where
 * the filesystem doesn't record it, the newest of mtime/ctime is the safe
 * fallback — it can only make a file look younger than it is.
 */
function createdAt(stat: { birthtimeMs: number; mtimeMs: number; ctimeMs: number }): number {
  // Unsupported birth times come back as 0 (the epoch), never as a real date.
  if (stat.birthtimeMs > Date.UTC(2000, 0, 1)) return stat.birthtimeMs;
  return Math.max(stat.mtimeMs, stat.ctimeMs);
}

/* ------------------------------------------------------------------ *
 * Retention
 *
 * Nothing else ever removes a finished download, so without this the
 * volume only grows. Runs on a timer from `src/instrumentation.ts`.
 * ------------------------------------------------------------------ */

/**
 * Deletes finished downloads older than RETENTION_DAYS: their history entries
 * and files first, then any file on disk past the same age — which also
 * catches files orphaned before list removal started deleting them.
 *
 * Files MeTube still lists are judged by their history entry; only files it
 * no longer knows about are judged by age on disk (see `createdAt`).
 */
export async function sweepDownloads(): Promise<{ files: number; entries: number }> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");

  // Without the history there's no telling what's still in flight; skip this
  // round rather than guess.
  const items = await listDownloads();
  const cutoff = Date.now() - RETENTION_MS;

  const expired = items.filter(
    (item) => item.group === "done" && item.expiresAt !== null && item.expiresAt < Date.now(),
  );
  const keep = new Set(
    items
      .filter((item) => !expired.includes(item) && item.filename)
      .map((item) => path.resolve(downloadsRoot(), item.filename!)),
  );

  let files = 0;
  const removed: string[] = [];
  for (const item of expired) {
    if (item.filename) {
      try {
        await deleteDownloadedFile(item.filename);
        files += 1;
      } catch (error) {
        // Keep the entry, so a file that couldn't go stays reachable.
        console.error(`Retention: couldn't delete ${item.filename}:`, error);
        continue;
      }
    }
    removed.push(item.id);
  }
  if (removed.length > 0) await deleteDownloads(removed, "done");

  const root = path.resolve(downloadsRoot());

  async function walk(dir: string): Promise<boolean> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    let empty = true;
    for (const entry of entries) {
      // Dotfiles cover MeTube's own state and yt-dlp's scratch; .part/.ytdl
      // are downloads in progress.
      if (entry.name.startsWith(".") || /\.(part|ytdl)$/.test(entry.name)) {
        empty = false;
        continue;
      }
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // An empty folder younger than an hour may be a playlist download
        // that hasn't written its first file yet; the next sweep gets it.
        const stat = await fs.stat(full).catch(() => null);
        const settled =
          stat !== null &&
          createdAt(stat) < Date.now() - 3_600_000;
        if ((await walk(full)) && settled) {
          await fs.rmdir(full).catch(() => {});
        } else {
          empty = false;
        }
        continue;
      }

      if (!entry.isFile() || keep.has(full)) {
        empty = false;
        continue;
      }

      try {
        const stat = await fs.stat(full);
        if (createdAt(stat) < cutoff) {
          await fs.unlink(full);
          files += 1;
        } else {
          empty = false;
        }
      } catch {
        empty = false;
      }
    }
    return empty;
  }

  await walk(root);
  return { files, entries: removed.length };
}
