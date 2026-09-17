import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  missing_code: "Google didn't send an authorization code. Try again.",
  bad_state: "That sign-in attempt expired or didn't match. Try again.",
  exchange_failed:
    "Couldn't complete sign-in with Google. Check the server logs.",
  not_allowed: "That Google account isn't allowed to use this toolhub.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const nextPath = typeof params.next === "string" ? params.next : undefined;

  const loginHref = nextPath
    ? `/api/auth/login?next=${encodeURIComponent(nextPath)}`
    : "/api/auth/login";

  return (
    <main className="page-glow flex min-h-screen items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          rauhan&rsquo;s <span className="accent-text">toolhub</span>
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Private tools. Sign in with the account they belong to.
        </p>

        {errorKey && (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {ERRORS[errorKey] ?? "Something went wrong signing in."}
          </p>
        )}

        <a
          href={loginHref}
          className="mt-7 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
        >
          <svg viewBox="0 0 18 18" aria-hidden="true" className="h-[18px] w-[18px]">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
            />
          </svg>
          Continue with Google
        </a>

        <p className="mt-5 text-xs leading-5 text-[var(--muted)]">
          Grants read-only access to your YouTube playlists, so private ones can
          be measured.
        </p>

        <p className="mt-4 text-xs text-[var(--muted)]">
          <a href="/privacy" className="underline hover:text-[var(--foreground)]">
            Privacy
          </a>
          <span className="mx-2">&middot;</span>
          <a href="/terms" className="underline hover:text-[var(--foreground)]">
            Terms
          </a>
        </p>
      </div>
    </main>
  );
}
