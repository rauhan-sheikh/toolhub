"use client";

import { useCallback, useState } from "react";
import { Spinner } from "@/components/icons";
import { formatDuration, formatHuman } from "@/lib/format";
import type { PlaylistOption, PlaylistSummary } from "@/lib/youtube";

const SPEEDS = [1.25, 1.5, 1.75, 2];

export function PlaylistTool() {
  const [input, setInput] = useState("");
  const [summary, setSummary] = useState<PlaylistSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [picker, setPicker] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistOption[] | null>(null);
  const [playlistsError, setPlaylistsError] = useState("");
  const [playlistsLoading, setPlaylistsLoading] = useState(false);

  const calculate = useCallback(async (value: string) => {
    const playlistId = value.trim();
    if (!playlistId) {
      setError("Paste a playlist URL or ID first.");
      return;
    }

    setError("");
    setSummary(null);
    setLoading(true);
    try {
      const response = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        setError(data.error || "Unable to calculate playlist duration.");
        return;
      }
      setSummary(data as PlaylistSummary);
    } catch {
      setError("Request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const togglePicker = useCallback(async () => {
    const next = !picker;
    setPicker(next);
    if (!next || playlists || playlistsLoading) return;

    setPlaylistsLoading(true);
    setPlaylistsError("");
    try {
      const response = await fetch("/api/playlists");
      const data = await response.json();
      if (!response.ok || data.error) {
        setPlaylistsError(data.error || "Couldn't load your playlists.");
        return;
      }
      setPlaylists(data.playlists as PlaylistOption[]);
    } catch {
      setPlaylistsError("Couldn't load your playlists.");
    } finally {
      setPlaylistsLoading(false);
    }
  }, [picker, playlists, playlistsLoading]);

  return (
    <>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <label
          htmlFor="playlistId"
          className="mb-2 block text-sm font-medium text-[var(--muted)]"
        >
          Playlist URL or ID
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="playlistId"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") calculate(input);
            }}
            placeholder="https://www.youtube.com/playlist?list=..."
            className="flex-1 rounded-xl border border-[var(--border)] bg-black/40 px-4 py-3 text-sm outline-none transition focus:accent-ring"
          />
          <button
            onClick={() => calculate(input)}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-xl accent-bg px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <Spinner />}
            {loading ? "Calculating" : "Calculate"}
          </button>
        </div>

        <button
          onClick={togglePicker}
          className="mt-4 text-sm accent-text transition hover:opacity-80"
        >
          {picker ? "Hide my playlists" : "Or pick from my playlists →"}
        </button>

        {picker && (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-black/30 p-2">
            {playlistsLoading && (
              <p className="flex items-center gap-2 px-3 py-4 text-sm text-[var(--muted)]">
                <Spinner /> Loading your playlists…
              </p>
            )}

            {playlistsError && (
              <p className="px-3 py-4 text-sm text-red-300">{playlistsError}</p>
            )}

            {playlists && playlists.length === 0 && (
              <p className="px-3 py-4 text-sm text-[var(--muted)]">
                This account has no playlists.
              </p>
            )}

            {playlists && playlists.length > 0 && (
              <ul className="max-h-80 overflow-y-auto">
                {playlists.map((playlist) => (
                  <li key={playlist.id}>
                    <button
                      onClick={() => {
                        setInput(playlist.id);
                        setPicker(false);
                        calculate(playlist.id);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {playlist.title}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {playlist.itemCount} videos
                        </span>
                      </span>
                      {playlist.privacy !== "public" && (
                        <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                          {playlist.privacy}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </p>
      )}

      {summary && <Results summary={summary} />}
    </>
  );
}

function Results({ summary }: { summary: PlaylistSummary }) {
  return (
    <section className="mt-6 space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        {summary.title && (
          <p className="mb-1 truncate text-sm text-[var(--muted)]">
            {summary.title}
          </p>
        )}
        <p className="text-5xl font-semibold tracking-tight tabular-nums">
          {formatDuration(summary.totalSeconds)}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {formatHuman(summary.totalSeconds)} across {summary.countedCount}{" "}
          {summary.countedCount === 1 ? "video" : "videos"}
        </p>

        {summary.unavailableCount > 0 && (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {summary.unavailableCount}{" "}
            {summary.unavailableCount === 1 ? "video is" : "videos are"} deleted
            or private and could not be counted — the real total is higher.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            At speed
          </h3>
          <ul className="space-y-2">
            {SPEEDS.map((speed) => (
              <li key={speed} className="flex justify-between text-sm">
                <span className="text-[var(--muted)]">{speed}×</span>
                <span className="tabular-nums">
                  {formatDuration(summary.totalSeconds / speed)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Breakdown
          </h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--muted)]">Average length</dt>
              <dd className="tabular-nums">
                {formatDuration(summary.averageSeconds)}
              </dd>
            </div>
            {summary.longest && (
              <div className="flex justify-between gap-4">
                <dt className="min-w-0 text-[var(--muted)]">
                  <span className="block truncate" title={summary.longest.title}>
                    Longest: {summary.longest.title}
                  </span>
                </dt>
                <dd className="shrink-0 tabular-nums">
                  {formatDuration(summary.longest.seconds)}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--muted)]">Items in playlist</dt>
              <dd className="tabular-nums">{summary.itemCount}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
