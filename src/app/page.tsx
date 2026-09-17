import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ToolIcon } from "@/components/icons";
import { TOOLS } from "@/lib/tools";
import { getSession } from "@/lib/session";

/**
 * The home page is deliberately public.
 *
 * Signed out it describes what the app is and what it asks of your Google
 * account; signed in it becomes the tool grid. Google's OAuth branding review
 * rejects a home page that sits behind a login ("Your home page is behind a
 * login page"), and a visitor landing on a bare sign-in box learns nothing.
 */
export default async function Home() {
  const session = await getSession();

  if (!session) return <PublicLanding />;

  return (
    <AppShell email={session.email}>
      <section className="mb-12 max-w-2xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] accent-text">
          Personal tools
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Small tools, built to scratch my own itches.
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-[var(--muted)]">
          Everything here runs on my own box, signed in as me. No accounts, no
          limits, no adverts telling me to upgrade.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.slug}
            href={`/tools/${tool.slug}`}
            style={{ "--accent": tool.accent } as React.CSSProperties}
            className="group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-[var(--surface-raised)]"
          >
            <div
              className="pointer-events-none absolute inset-x-0 -top-24 h-40 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
              style={{ background: "hsl(var(--accent) / 0.22)" }}
            />
            <div className="relative">
              <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl accent-bg text-white shadow-lg">
                <ToolIcon icon={tool.icon} />
              </span>
              <h2 className="text-lg font-semibold tracking-tight">
                {tool.name}
              </h2>
              <p className="mt-1 text-sm accent-text">{tool.tagline}</p>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                {tool.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

function PublicLanding() {
  return (
    <main className="page-glow min-h-screen px-5 py-16">
      <div className="mx-auto max-w-3xl">
        <header className="max-w-2xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] accent-text">
            Personal tools
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            rauhan&rsquo;s <span className="accent-text">toolhub</span>
          </h1>
          <p className="mt-4 text-[15px] leading-7 text-[var(--muted)]">
            A small, self-hosted collection of utilities built for my own use
            and run on my own server. Sign-in is limited to a short allowlist of
            Google accounts, so it isn&rsquo;t open to general sign-ups &mdash;
            but here&rsquo;s what it does.
          </p>

          <a
            href="/api/auth/login"
            className="mt-7 inline-flex items-center gap-3 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
          >
            <svg viewBox="0 0 18 18" aria-hidden="true" className="h-[18px] w-[18px]">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
            </svg>
            Sign in with Google
          </a>
        </header>

        <section className="mt-14 grid gap-4 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <div
              key={tool.slug}
              style={{ "--accent": tool.accent } as React.CSSProperties}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
            >
              <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl accent-bg text-white shadow-lg">
                <ToolIcon icon={tool.icon} />
              </span>
              <h2 className="text-lg font-semibold tracking-tight">
                {tool.name}
              </h2>
              <p className="mt-1 text-sm accent-text">{tool.tagline}</p>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                {tool.description}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-14 max-w-2xl">
          <h2 className="text-lg font-semibold tracking-tight">
            What signing in grants
          </h2>
          <p className="mt-3 text-[15px] leading-7 text-[var(--muted)]">
            Google sign-in is used for two things: to confirm your email against
            the allowlist, and to request <strong className="text-[var(--foreground)]">read-only</strong>{" "}
            access to your YouTube playlists so the duration tool can measure
            private ones. The app cannot modify anything in your account, stores
            no data in any database, and keeps your token encrypted in a cookie
            in your own browser.
          </p>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Full detail in the{" "}
            <Link href="/privacy" className="underline hover:text-[var(--foreground)]">
              privacy policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="underline hover:text-[var(--foreground)]">
              terms of service
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
