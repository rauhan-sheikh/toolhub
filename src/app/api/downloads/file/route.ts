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

type ByteRange = { start: number; end: number };

/**
 * A single `bytes=` range, or null to send the whole file. Multi-range
 * requests are rare and legal to answer in full, so they get the whole file.
 */
function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const [, from, to] = match;
  if (from === "" && to === "") return null;

  let start: number;
  let end: number;
  if (from === "") {
    // Suffix form: the last N bytes.
    const length = Number(to);
    if (length === 0) return "unsatisfiable";
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }

  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/**
 * Streams a finished download to the browser.
 *
 * The file is read from the shared volume rather than proxied from MeTube, so
 * this keeps working even when the engine is down, and MeTube stays unreachable
 * from outside the host.
 *
 * Supports Range requests with validators, so an interrupted download resumes
 * where it stopped instead of sending the whole file again.
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
    const { size, mtime, mtimeMs } = await stat(path);
    const filename = basename(path);
    const type = CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

    const asciiName = filename
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_");

    // Browsers only resume a download when the server offers a validator.
    const etag = `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
    const lastModified = mtime.toUTCString();

    const headers: Record<string, string> = {
      "Content-Type": type,
      // Header values are ByteStrings, so any character above U+00FF throws
      // when the header is set. Video titles routinely contain them — a real
      // download here was named "… ｜ …" (U+FF5C) — so the quoted form has to
      // be ASCII-only. The true name rides on the RFC 5987 parameter, which
      // every current browser prefers anyway.
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Last-Modified": lastModified,
    };

    // If-Range: resume only if the file is still the one the client started.
    const ifRange = request.headers.get("if-range");
    const range =
      !ifRange || ifRange === etag || ifRange === lastModified
        ? parseRange(request.headers.get("range"), size)
        : null;

    if (range === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    }

    const { start, end } = range ?? { start: 0, end: size - 1 };
    const body = Readable.toWeb(
      // An empty file has no valid range to read; stream nothing for it.
      createReadStream(path, size > 0 ? { start, end } : undefined),
    ) as unknown as ReadableStream<Uint8Array>;

    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        "Content-Length": String(size > 0 ? end - start + 1 : 0),
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
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
