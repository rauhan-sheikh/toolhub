"use client";

import { useState } from "react";

export default function Home() {
  const [playlistId, setPlaylistId] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function calculate() {
    setError("");
    setResult("");
    setLoading(true);

    if (!playlistId.trim()) {
      setError("Please enter a playlist ID.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/playlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ playlistId: playlistId.trim() }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        setError(data.error || "Unable to calculate playlist duration.");
        return;
      }

      const total = Number(data.totalSeconds ?? 0);
      if (Number.isNaN(total)) {
        setError("Invalid duration returned from the API.");
        return;
      }

      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;

      setResult(
        `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
      );
    } catch {
      setError("Request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(255,0,0,0.18),_transparent_30%),linear-gradient(135deg,_#0f0f0f,_#111111_45%,_#1f1f1f)] px-4 py-10 text-slate-100">
      <section className="w-full max-w-2xl rounded-3xl border border-white/10 bg-black/85 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="mb-8 space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-red-400">
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex h-7 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-red-500/30">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <path d="M8 5v14l11-7L8 5z" />
                </svg>
              </span>
              YouTube Playlist Analyzer
            </span>
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl text-white">
            Find the total runtime of any playlist in seconds.
          </h1>
          <p className="max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
            Paste a playlist ID and get the total duration instantly. The app
            calculates the full runtime across all videos in the playlist.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-white/5 p-4 shadow-inner shadow-black/30">
          <label
            className="mb-2 block text-sm font-medium text-slate-300"
            htmlFor="playlistId"
          >
            Playlist ID or URL
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="playlistId"
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-3 text-sm text-white outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
              placeholder="https://www.youtube.com/playlist?list=PLw-VjHDlEOgtkxc6I7kP9tskQfR4c4gkS"
              value={playlistId}
              onChange={(e) => setPlaylistId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") calculate();
              }}
            />
            <button
              onClick={calculate}
              disabled={loading}
              className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Calculating..." : "Calculate"}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-white/5 p-6">
          <p className="text-sm font-medium text-slate-300">Result</p>
          {error ? (
            <p className="mt-3 text-sm text-red-300">{error}</p>
          ) : result ? (
            <div className="mt-3 space-y-2">
              <p className="text-4xl font-semibold text-white">{result}</p>
              <p className="text-sm text-slate-400">Total playlist duration</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              Enter a playlist ID to see the total duration here.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
