# Rauhan's Toolhub

A small collection of personal tools, gated behind Google sign-in and
self-hosted on an Oracle Cloud Ampere instance.

| Tool | What it does |
| --- | --- |
| **Playlist Duration** | Total runtime of any YouTube playlist, **private ones included**, with playback-speed maths and a count of unavailable videos |
| **Downloader** | A yt-dlp front end for video, audio, subtitles and thumbnails, with a live queue |

## Architecture

```
┌─ caddy    :80/:443   TLS termination, reverse proxy   ← only published ports
├─ web      :3000      Next.js 16 — UI, API, auth
├─ metube   :8081      yt-dlp engine                    ← internal network only
└─ warp     :1080      Cloudflare WARP egress proxy     ← internal network only
```

MeTube is never exposed to the internet. The only way to queue a download is
through the authenticated app.

**Why WARP?** YouTube blocks yt-dlp from datacenter IP ranges — Oracle included
— with *"Sign in to confirm you're not a bot"*. That's
[yt-dlp#9015](https://github.com/yt-dlp/yt-dlp/issues/9015), closed as *not
planned* because it's Google policy rather than a bug. Routing the engine's
egress through Cloudflare WARP avoids it. This is a workaround, not a
guarantee; if downloads start failing, look at the egress path first.

## Auth

One Google OAuth client does two jobs: `openid`/`email` gates the app against an
`ALLOWED_EMAILS` allowlist, and `youtube.readonly` reads playlists.

The refresh token lives in an **encrypted (JWE) httpOnly cookie** — there's no
database to run. `src/proxy.ts` does an optimistic cookie-presence check on
every route; real authorization happens in each handler via `requireSession()`
in [`src/lib/api.ts`](src/lib/api.ts).

> **Set the Google consent screen to "In production", not "Testing".** In
> Testing, Google expires refresh tokens after 7 days and the app quietly breaks
> every week.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

The downloader degrades gracefully when `METUBE_URL` is unset — it shows a
"not configured" notice and the rest of the toolhub works normally.

## Deployment

See **[DEPLOY.md](DEPLOY.md)** for the full Oracle Cloud walkthrough, including
how to stay inside the Always Free limits on a Pay As You Go account.

```bash
docker compose up -d --build
```

## Adding a tool

1. Add an entry to `TOOLS` in [`src/lib/tools.ts`](src/lib/tools.ts)
2. Create `src/app/tools/<slug>/page.tsx`

The landing grid and nav both read from that registry, so there's nothing else
to keep in sync.

## Layout

```
src/
├── proxy.ts              route gate (Next 16 renamed Middleware → Proxy)
├── lib/
│   ├── session.ts        JWE cookie encrypt/decrypt
│   ├── google.ts         OAuth client, scopes, token exchange
│   ├── api.ts            requireSession + error normalisation
│   ├── youtube.ts        playlist stats (server-only; imports googleapis)
│   ├── metube.ts         download engine adapter
│   ├── format.ts         pure formatters, safe for client components
│   └── tools.ts          tool registry
├── components/           AppShell, ToolCard, icons
└── app/
    ├── api/              auth, playlist, playlists, downloads, health
    ├── login/
    └── tools/<slug>/
```

`format.ts` is deliberately separate from `youtube.ts`: the latter imports
googleapis, and pulling that into a client component would ship the whole SDK to
the browser.
