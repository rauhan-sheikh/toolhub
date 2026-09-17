import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import {
  EngineOfflineError,
  FileNotAvailableError,
  deleteDownloadedFile,
  deleteDownloads,
  isConfigured,
  retryDownload,
} from "@/lib/metube";

/** Mutations on an existing download: remove from the queue/history, or retry. */
export async function POST(request: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "METUBE_URL is not set." },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const action = String(body?.action ?? "");

    if (action === "delete") {
      const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
      const where = body?.where === "done" ? "done" : "queue";
      if (ids.length === 0) {
        return NextResponse.json({ error: "No ids given." }, { status: 400 });
      }
      await deleteDownloads(ids, where);
      return NextResponse.json({ ok: true });
    }

    // Removes the entry AND the file. MeTube's own delete only clears the
    // list unless DELETE_FILE_ON_TRASHCAN is on, which would make every
    // removal destructive; doing it here keeps the choice per-item.
    if (action === "deleteFile") {
      const id = String(body?.id ?? "");
      const filename = String(body?.filename ?? "");
      if (!id || !filename) {
        return NextResponse.json(
          { error: "Need both an id and a filename." },
          { status: 400 },
        );
      }

      await deleteDownloadedFile(filename);
      // Only drop it from the list once the file is actually gone, so a
      // failure here never leaves an orphaned file with no way back to it.
      await deleteDownloads([id], "done");
      return NextResponse.json({ ok: true });
    }

    if (action === "retry") {
      const id = String(body?.id ?? "");
      if (!id) {
        return NextResponse.json({ error: "No id given." }, { status: 400 });
      }
      await retryDownload(id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof EngineOfflineError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof FileNotAvailableError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Download action failed:", error);
    return NextResponse.json({ error: "Engine error." }, { status: 502 });
  }
}
