import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ToolIcon } from "@/components/icons";
import { TOOLS } from "@/lib/tools";
import { getSession } from "@/lib/session";

export default async function Home() {
  const session = await getSession();
  // Proxy already gated this, but a stale or tampered cookie reaches here.
  if (!session) redirect("/login");

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
