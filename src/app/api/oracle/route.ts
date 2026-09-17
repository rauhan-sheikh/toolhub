import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import {
  OciUnavailableError,
  getSnapshot,
  isConfigured,
} from "@/lib/oci";

// Querying the Usage API takes several seconds; don't let Next cache it.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  if (!isConfigured()) {
    return NextResponse.json(
      {
        available: false,
        error:
          "OCI_TENANCY_OCID is not set, so the toolhub doesn't know which tenancy to read.",
      },
      { status: 200 },
    );
  }

  const force = new URL(request.url).searchParams.get("refresh") === "1";

  try {
    const snapshot = await getSnapshot(force);
    return NextResponse.json({ available: true, snapshot });
  } catch (error) {
    if (error instanceof OciUnavailableError) {
      return NextResponse.json(
        { available: false, error: error.message },
        { status: 200 },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    // The overwhelmingly likely cause on first run is a missing IAM policy,
    // so say that rather than echoing Oracle's opaque wording.
    const isAuthz = /NotAuthorizedOrNotFound|401|403/.test(message);
    console.error("OCI snapshot failed:", error);
    return NextResponse.json(
      {
        available: false,
        error: isAuthz
          ? "Oracle refused the read. The instance's Dynamic Group or IAM policy is probably missing or misspelled."
          : message,
      },
      { status: 200 },
    );
  }
}
