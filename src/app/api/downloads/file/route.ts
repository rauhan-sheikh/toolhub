import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { FileNotAvailableError, resolveDownloadPath } from "@/lib/metube";

// Files are large and per-request; never cache or prerender this.
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".opus": "audio/opus",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".vtt": "text/vtt",
  ".srt": "application/x-subrip",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Streams a finished download to the browser.
 *
 * The file is read from the shared volume rather than proxied from MeTube, so
 * this keeps working even when the engine is down, and MeTube stays unreachable
 * from outside the host.
 */
export async function GET(request: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const name = new URL(request.url).searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "No file given." }, { status: 400 });
  }

  try {
    const path = await resolveDownloadPath(name);
    const { size } = await stat(path);
    const filename = basename(path);
    const type = CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

    const body = Readable.toWeb(
      createReadStream(path),
    ) as unknown as ReadableStream<Uint8Array>;

    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(size),
        // RFC 5987 form as well, so non-ASCII titles survive the trip.
        "Content-Disposition": `attachment; filename="${filename.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof FileNotAvailableError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Serving download failed:", error);
    return NextResponse.json(
      { error: "Couldn't read that file." },
      { status: 500 },
    );
  }
}
