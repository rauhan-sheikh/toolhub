import Link from "next/link";
import { TOOLS } from "@/lib/tools";
import { ToolIcon } from "@/components/icons";

/**
 * Page chrome for every signed-in route. `accent` sets the CSS custom property
 * the whole subtree tints from.
 */
export function AppShell({
  email,
  accent,
  children,
}: {
  email: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="page-glow min-h-screen"
      style={accent ? ({ "--accent": accent } as React.CSSProperties) : undefined}
    >
      <header className="border-b border-[var(--border)]/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:gap-6 sm:px-5">
          <Link
            href="/"
            className="shrink-0 text-sm font-semibold tracking-tight text-[var(--foreground)] transition hover:opacity-80"
          >
            rauhan&rsquo;s <span className="accent-text">toolhub</span>
          </Link>

          <nav className="flex min-w-0 items-center gap-0.5 sm:gap-1">
            {TOOLS.map((tool) => (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                title={tool.name}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--muted)] transition hover:bg-white/5 hover:text-[var(--foreground)] sm:px-2.5"
              >
                <ToolIcon icon={tool.icon} className="h-4 w-4 shrink-0" />
                <span className="hidden lg:inline">{tool.name}</span>
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span
              className="hidden text-xs text-[var(--muted)] md:inline"
              title={email}
            >
              {email}
            </span>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted)] transition hover:border-white/25 hover:text-[var(--foreground)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-5 sm:py-14">
        {children}
      </main>
    </div>
  );
}
