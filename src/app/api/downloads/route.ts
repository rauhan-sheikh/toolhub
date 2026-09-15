import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import {
  EngineOfflineError,
  addDownload,
  isConfigured,
  listDownloads,
} from "@/lib/metube";

function offline(message: string, configured: boolean) {
  return NextResponse.json(
    { configured, offline: true, error: message, items: [] },
    { status: 503 },
  );
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  if (!isConfigured()) {
    return NextResponse.json({
      configured: false,
      offline: true,
      items: [],
      error: "METUBE_URL is not set.",
    });
  }

  try {
    return NextResponse.json({
      configured: true,
      offline: false,
      items: await listDownloads(),
    });
  } catch (error) {
    if (error instanceof EngineOfflineError) {
      return offline(error.message, true);
    }
    console.error("Failed to list downloads:", error);
    return NextResponse.json(
      { configured: true, offline: false, items: [], error: "Engine error." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  if (!isConfigured()) {
    return offline("METUBE_URL is not set.", false);
  }

  try {
    const body = await request.json();
    const url = String(body?.url ?? "").trim();
    if (!url) {
      return NextResponse.json({ error: "A URL is required." }, { status: 400 });
    }

    const limit = Number(body?.playlistItemLimit ?? 0);

    await addDownload({
      url,
      downloadType: body?.downloadType === "audio" ? "audio" : "video",
      quality: typeof body?.quality === "string" ? body.quality : undefined,
      format: typeof body?.format === "string" ? body.format : undefined,
      playlistItemLimit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof EngineOfflineError) {
      return offline(error.message, true);
    }
    console.error("Failed to queue download:", error);
    return NextResponse.json(
      { error: "The engine rejected that URL." },
      { status: 502 },
    );
  }
}
