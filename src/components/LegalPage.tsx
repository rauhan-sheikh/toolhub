import Link from "next/link";

/**
 * Layout for the public legal pages. Deliberately not AppShell — these must
 * render for signed-out visitors (Google fetches them during OAuth review).
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="page-glow min-h-screen px-5 py-14">
      <article className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight transition hover:opacity-80"
        >
          rauhan&rsquo;s <span className="accent-text">toolhub</span>
        </Link>

        <h1 className="mt-8 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Last updated {updated}
        </p>

        <div className="mt-8 space-y-6 text-[15px] leading-7 text-[var(--muted)] [&_a]:underline [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--foreground)] [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-[var(--foreground)]">
          {children}
        </div>
      </article>
    </main>
  );
}
