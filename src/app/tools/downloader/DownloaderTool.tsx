"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/icons";
import { formatBytes, formatDuration } from "@/lib/format";
import type { DownloadItem } from "@/lib/metube";

const VIDEO_QUALITIES = [
  { value: "best", label: "Best available" },
  { value: "1440", label: "1440p" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
];

const VIDEO_FORMATS = [
  { value: "any", label: "Any container" },
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
];

const AUDIO_FORMATS = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A" },
  { value: "opus", label: "Opus" },
  { value: "flac", label: "FLAC" },
];

const ACTIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 30_000;

function isActive(item: DownloadItem): boolean {
  return item.group !== "done";
}

/** What a poll can change on screen; equal signatures mean nothing moved. */
function signature(items: DownloadItem[]): string {
  return items
    .map((item) => `${item.id}:${item.status}:${item.percent ?? ""}`)
    .join("|");
}

export function DownloaderTool() {
  const [url, setUrl] = useState("");
  const [downloadType, setDownloadType] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState("best");
  const [format, setFormat] = useState("any");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [items, setItems] = useState<DownloadItem[]>([]);
  const [engine, setEngine] = useState<{
    configured: boolean;
    offline: boolean;
    error?: string;
  }>({ configured: true, offline: false });
  const [loaded, setLoaded] = useState(false);

  // Held in a ref so the polling loop can read the current cadence without
  // being torn down and rebuilt on every tick.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<DownloadItem[]> => {
    try {
      const response = await fetch("/api/downloads", { cache: "no-store" });
      const data = await response.json();
      setEngine({
        configured: data.configured ?? false,
        offline: data.offline ?? false,
        error: data.error,
      });
      const next: DownloadItem[] = data.items ?? [];
      setItems(next);
      return next;
    } catch {
      setEngine({
        configured: true,
        offline: true,
        error: "Couldn't reach the server.",
      });
      return [];
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Bumped whenever the loop restarts, so a poll still in flight from the
    // previous run can't schedule a second, parallel loop.
    let generation = 0;
    let delay = ACTIVE_POLL_MS;
    let last = "";

    const stop = () => {
      generation += 1;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };

    const tick = async (run: number) => {
      const next = await refresh();
      // Opened straight into a background tab: show the first result, then
      // wait for visibilitychange.
      if (run !== generation || document.hidden) return;

      const current = signature(next);
      if (!next.some(isActive)) {
        delay = IDLE_POLL_MS;
      } else if (current === last) {
        // Active but unchanged, probably stuck: back off towards idle.
        delay = Math.min(delay * 2, IDLE_POLL_MS);
      } else {
        delay = ACTIVE_POLL_MS;
      }
      last = current;
      timer.current = setTimeout(() => tick(run), delay);
    };

    // Polls only while the tab is visible; nobody is watching a progress bar
    // in a background tab, and it would otherwise poll for as long as it's open.
    const start = () => {
      stop();
      delay = ACTIVE_POLL_MS;
      tick(generation);
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [refresh]);

  const submit = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setFormError("Paste a link first.");
      return;
    }

    setFormError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, downloadType, quality, format }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        setFormError(data.error || "Couldn't queue that download.");
        return;
      }
      setUrl("");
      await refresh();
    } catch {
      setFormError("Request failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [url, downloadType, quality, format, refresh]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      await fetch("/api/downloads/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await refresh();
    },
    [refresh],
  );

  const formats = downloadType === "audio" ? AUDIO_FORMATS : VIDEO_FORMATS;

  return (
    <>
      {engine.offline && <EngineNotice engine={engine} />}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <label
          htmlFor="downloadUrl"
          className="mb-2 block text-sm font-medium text-[var(--muted)]"
        >
          Link
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="downloadUrl"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 rounded-xl border border-[var(--border)] bg-black/40 px-4 py-3 text-sm outline-none transition focus:accent-ring"
          />
          <button
            onClick={submit}
            disabled={submitting || engine.offline}
            className="flex items-center justify-center gap-2 rounded-xl accent-bg px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Spinner />}
            {submitting ? "Queueing" : "Download"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <Segmented
            value={downloadType}
            onChange={(next) => {
              setDownloadType(next);
              setFormat(next === "audio" ? "mp3" : "any");
            }}
            options={[
              { value: "video", label: "Video" },
              { value: "audio", label: "Audio" },
            ]}
          />

          {downloadType === "video" && (
            <Select
              label="Quality"
              value={quality}
              onChange={setQuality}
              options={VIDEO_QUALITIES}
            />
          )}

          <Select
            label="Format"
            value={format}
            onChange={setFormat}
            options={formats}
          />
        </div>

        {formError && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {formError}
          </p>
        )}
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Queue
        </h2>

        {!loaded && (
          <p className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-6 text-sm text-[var(--muted)]">
            <Spinner /> Loading…
          </p>
        )}

        {loaded && items.length === 0 && (
          <p className="rounded-2xl border border-dashed border-[var(--border)] px-5 py-10 text-center text-sm text-[var(--muted)]">
            Nothing queued yet.
          </p>
        )}

        <ul className="space-y-3">
          {items.map((item) => (
            <DownloadRow key={`${item.group}-${item.id}`} item={item} onAct={act} />
          ))}
        </ul>
      </section>
    </>
  );
}

function EngineNotice({
  engine,
}: {
  engine: { configured: boolean; error?: string };
}) {
  return (
    <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
      <h2 className="text-sm font-semibold text-amber-100">
        {engine.configured
          ? "Download engine is unreachable"
          : "Download engine not configured"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-200/80">
        {engine.configured ? (
          <>
            The app can&rsquo;t reach MeTube. Check the container is running:{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">
              docker compose ps
            </code>
            .
          </>
        ) : (
          <>
            Set <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">METUBE_URL</code>{" "}
            to point at a MeTube instance, then restart the app. Everything else
            in the toolhub keeps working without it.
          </>
        )}
      </p>
      {engine.error && (
        <p className="mt-2 text-xs text-amber-200/60">{engine.error}</p>
      )}
    </div>
  );
}

function DownloadRow({
  item,
  onAct,
}: {
  item: DownloadItem;
  onAct: (body: Record<string, unknown>) => void;
}) {
  const done = item.group === "done";
  const failed = item.status === "error";
  const hasFile = done && !failed && Boolean(item.filename);
  const percent = Math.max(0, Math.min(100, item.percent ?? 0));

  return (
    <li className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-start min-[420px]:gap-4">
        <div className="min-w-0 flex-1">
          <p
            className="line-clamp-2 text-sm font-medium break-words"
            title={item.title}
          >
            {item.title}
          </p>
          <p className="mt-1 line-clamp-2 text-xs break-words text-[var(--muted)]">
            {failed
              ? (item.error ?? item.msg ?? "Failed")
              : done
                ? `Finished · ${formatBytes(item.size)} · ${expiry(item.expiresAt)}`
                : [
                    item.status,
                    item.speed ? `${formatBytes(item.speed)}/s` : null,
                    item.eta ? `ETA ${formatDuration(item.eta)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 min-[420px]:justify-end">
          {hasFile && (
            <a
              href={`/api/downloads/file?name=${encodeURIComponent(item.filename ?? "")}`}
              download
              title="Save this file to your device"
              className="rounded-lg accent-bg px-2.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
            >
              Save to device
            </a>
          )}

          {failed && (
            <button
              onClick={() => onAct({ action: "retry", id: item.id })}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted)] transition hover:border-white/25 hover:text-[var(--foreground)]"
            >
              Retry
            </button>
          )}

          {!hasFile && (
            <button
              onClick={() =>
                onAct({
                  action: "delete",
                  ids: [item.id],
                  where: done ? "done" : "queue",
                })
              }
              title={
                done
                  ? "Remove this entry from the list."
                  : "Stop this download and remove it from the queue."
              }
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted)] transition hover:border-white/25 hover:text-[var(--foreground)]"
            >
              {done ? "Remove" : "Cancel"}
            </button>
          )}

          {hasFile && (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `Permanently delete "${item.title}" from the server? This cannot be undone.`,
                  )
                ) {
                  onAct({
                    action: "deleteFile",
                    id: item.id,
                    filename: item.filename,
                  });
                }
              }}
              title="Delete the file from the server and remove it from the list"
              className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-300 transition hover:border-red-500/60 hover:bg-red-500/10"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {!done && !failed && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full accent-bg transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </li>
  );
}

/** "deleted from the server in 3 days", from the retention deadline. */
function expiry(expiresAt: number | null): string {
  if (expiresAt === null) return "saved on the server";
  const days = Math.ceil((expiresAt - Date.now()) / 86_400_000);
  if (days <= 0) return "deleted from the server soon";
  return `deleted from the server in ${days} day${days === 1 ? "" : "s"}`;
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-xl border border-[var(--border)] bg-black/30 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            value === option.value
              ? "accent-bg text-white"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-black/30 px-3 py-1.5">
      <span className="shrink-0 text-xs text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 bg-transparent text-xs font-medium outline-none"
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            className="bg-[var(--surface)]"
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
