/**
 * Runs once when the server starts (Next's instrumentation hook).
 *
 * Used for the one piece of background work the app has: expiring finished
 * downloads, so the volume doesn't grow for ever. A timer here rather than a
 * sweep on page load means it happens even if the downloader is never opened.
 */

const FIRST_SWEEP_MS = 60_000; // let MeTube finish starting
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { isConfigured, sweepDownloads } = await import("@/lib/metube");
  if (!isConfigured()) return;

  const sweep = async () => {
    try {
      const { files, entries } = await sweepDownloads();
      if (files || entries) {
        console.log(
          `Retention: removed ${files} file(s) and ${entries} list entr${entries === 1 ? "y" : "ies"}.`,
        );
      }
    } catch (error) {
      console.error(
        "Retention sweep skipped:",
        error instanceof Error ? error.message : error,
      );
    }
  };

  // unref() so a pending sweep never holds the process open on shutdown.
  setTimeout(sweep, FIRST_SWEEP_MS).unref();
  setInterval(sweep, SWEEP_EVERY_MS).unref();
}
