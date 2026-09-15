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
  timestamp: number | null;
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

function normalize(raw: RawDownload, group: DownloadItem["group"]): DownloadItem {
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;

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
    timestamp: num(raw.timestamp),
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
