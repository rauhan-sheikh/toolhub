import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getSession } from "@/lib/session";
import { getTool } from "@/lib/tools";
import { PlaylistTool } from "./PlaylistTool";

const tool = getTool("playlist-duration")!;

export const metadata: Metadata = {
  title: tool.name,
  description: tool.description,
};

export default async function PlaylistDurationPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AppShell email={session.email} accent={tool.accent}>
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {tool.name}
        </h1>
        <p className="mt-3 text-[15px] leading-7 text-[var(--muted)]">
          {tool.description}
        </p>
      </header>

      <PlaylistTool />
    </AppShell>
  );
}
