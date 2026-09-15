import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { authedClient } from "@/lib/google";
import { listMyPlaylists } from "@/lib/youtube";

/** The signed-in user's own playlists — the point being private ones show up. */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  try {
    const playlists = await listMyPlaylists(
      authedClient(auth.session.refreshToken),
    );
    return NextResponse.json({ playlists });
  } catch (error) {
    return errorResponse(error);
  }
}
