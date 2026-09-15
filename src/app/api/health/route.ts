import { NextResponse } from "next/server";

/** Unauthenticated liveness probe for the container healthcheck. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
