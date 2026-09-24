# Rauhan's Toolhub

A small collection of personal tools, gated behind Google sign-in and
self-hosted on an Oracle Cloud Ampere instance.

| Tool | What it does |
| --- | --- |
| **Playlist Duration** | Total runtime of any YouTube playlist, **private ones included**, with playback-speed maths and a count of unavailable videos |
| **Downloader** | A yt-dlp front end for video, audio, subtitles and thumbnails, with a live queue. Finished files stay on the server for 7 days |
| **Cloud Watch** | Oracle tenancy spend, Always Free headroom with month-end projection, budget alerts and full resource inventory |

## Architecture

TLS and routing are **not** part of this stack. They live in a shared, project-
independent proxy (`infra/`) so the same VPS can host other projects — Dockerised
or otherwise.

```
infra/  caddy   :80/:443  ← the only published ports on the box
        └─ sites/*.caddy     one file per project
           owns the `edge` network

toolhub/
  web     joins `edge` + `backend`   Next.js 16 — UI, API, auth
  metube  `backend` only             yt-dlp engine
  warp    `backend` only             Cloudflare WARP egress proxy
```

Nothing in this stack publishes a port. Caddy reaches the app by container name
over the shared `edge` network; MeTube and WARP sit on `backend` and are
unreachable from outside the host entirely. The only way to queue a download is
through the authenticated app.

Other projects plug in the same way — join `edge` and add a site file, or, if
not Dockerised, bind to a host port and let Caddy reach it via
`host.docker.internal`. See [DEPLOY.md](DEPLOY.md#adding-another-project).

## CI/CD

Push to `main` → [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
builds the image on a **native arm64 runner**, pushes it to GHCR, then SSHes in
to `docker compose pull && up -d`.

The VPS never compiles anything, so a deploy doesn't compete with the app for
the box's 2 OCPUs. Images are tagged `latest` and by commit SHA, so rolling back
is `TOOLHUB_IMAGE=ghcr.io/…:<sha> docker compose up -d web`.

Required repo secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. GHCR needs no
long-lived credential on the server — the workflow forwards a job-scoped token
for the pull and logs out afterwards.

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

The shared proxy owns the `edge` network, so it goes up first:

```bash
cd infra && docker compose up -d      # once per box
cd ..    && docker compose up -d      # per project
```

## Adding a tool

1. Add an entry to `TOOLS` in [`src/lib/tools.ts`](src/lib/tools.ts)
2. Create `src/app/tools/<slug>/page.tsx`

The landing grid and nav both read from that registry, so there's nothing else
to keep in sync.

## Layout

```
infra/                    shared edge proxy — project-independent, deploy once
├── docker-compose.yml    caddy; owns ports 80/443 and the `edge` network
├── Caddyfile             global options + `import sites/*.caddy`
└── sites/                one file per project
.github/workflows/
└── deploy.yml            arm64 build → GHCR → SSH deploy
src/
├── proxy.ts              route gate (Next 16 renamed Middleware → Proxy)
├── lib/
│   ├── session.ts        JWE cookie encrypt/decrypt
│   ├── google.ts         OAuth over fetch: scopes, token exchange, access-token cache
│   ├── api.ts            requireSession + error normalisation
│   ├── youtube.ts        playlist stats over the YouTube REST API (server-only)
│   ├── metube.ts         download engine adapter
│   ├── format.ts         pure formatters, safe for client components
│   └── tools.ts          tool registry
├── components/           AppShell, ToolCard, icons
└── app/
    ├── api/              auth, playlist, playlists, downloads, health
    ├── login/
    └── tools/<slug>/
```

`format.ts` is deliberately separate from `youtube.ts`: the latter is
`server-only` and carries the user's access token, so client components import
only its types.

There is no Google SDK. `googleapis` eagerly loads ~300 API clients (≈200 MB)
to make the four REST calls this app needs, so `google.ts` and `youtube.ts` use
`fetch` directly and `jose` verifies the id_token.
