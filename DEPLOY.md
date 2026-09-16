# Deploying to Oracle Cloud

The VPS is **multipurpose**. TLS and routing live in a shared `infra` stack that
knows nothing about any particular project; each project — Dockerised or not —
plugs into it.

```
infra/          caddy            ← owns ports 80/443 and the `edge` network
  └─ sites/     one .caddy file per project

toolhub/        web ──────────── joins `edge`, no published ports
                metube, warp ─── `backend` only, unreachable from outside

any-other-app   joins `edge`, or runs on a host port and is reached
                via host.docker.internal
```

Your account is **Pay As You Go**, so Always Free resources stay free but
nothing stops you provisioning billable ones. Section 1 is about not doing that.

---

## 1. Stay free

Oracle charges only for usage **above** the Always Free limits:

| Resource | Always Free allowance | What to pick |
| --- | --- | --- |
| Ampere A1 compute | 1,500 OCPU-hrs + 9,000 GB-hrs / month | **2 OCPU / 12 GB**, one instance |
| Block storage (boot + block) | **200 GB total** | one 100 GB boot volume |
| Outbound transfer | 10 TB / month | irrelevant at personal scale |

> **Ampere was halved.** Oracle cut Always Free A1 from 4 OCPU / 24 GB to
> **2 OCPU / 12 GB** on 15 June 2026. Most guides still quote the old number —
> asking for 4 OCPU means paying for two of them.

**Set a budget alert first.** Billing & Cost Management → Budgets → Create
Budget → monthly **$1**, alert rule on **Actual** spend at **1%**. Confirm it
shows **Active**.

While provisioning, look for the **"Always Free-eligible"** label — Oracle marks
qualifying options explicitly. Check **Billing → Cost Analysis** after 48 hours;
it should read $0.00. If it doesn't, note that block volumes default to
**Balanced (VPU 10)** and VPU bills separately from capacity — you can drop a
volume to **Lower Cost (VPU 0)** at any time with no downtime.

## 2. Create the instance

Compute → Instances → Create instance.

- **Image**: Canonical Ubuntu 24.04, **aarch64** build
- **Shape**: Ampere → `VM.Standard.A1.Flex` → **2 OCPUs / 12 GB**
- **Boot volume**: custom size **100 GB**
- **Networking**: new VCN, **assign a public IPv4 address**
- **SSH keys**: upload your public key

> "Out of host capacity" on Ampere is common and is not a billing problem —
> retry, or switch availability domain.

## 3. Open the firewall — both layers

**This is the step that bites.** A misconfigured firewall here produces a
*connection timeout* from outside while every container looks perfectly healthy,
because packets are dropped silently before they ever reach Docker. Caddy also
can't get a certificate, since Let's Encrypt can't reach port 80.

**Layer 1 — VCN security list.** Networking → Virtual Cloud Networks → your VCN
→ Subnet → Security List → **Add Ingress Rules**:

| Source CIDR | Protocol | Dest. port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

This is usually the culprit. Docker publishes ports via DNAT, which bypasses the
host's `INPUT` chain entirely — so the VCN list is often the only thing standing
in the way.

**Layer 2 — host iptables.** Oracle's Ubuntu images drop everything but SSH:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Inserting at position 1 rather than a fixed index, because the rule numbering
differs between images.

Never open 8081 (MeTube) or 1080 (WARP) — they stay on the internal network.

### Diagnosing "it times out"

```bash
# Does the proxy answer on the box itself? (bypasses both firewall layers)
curl -sv http://localhost/ 2>&1 | tail -15

# Is DNS pointing at this instance?
dig +short tools.rauhansheikh.com; curl -s ifconfig.me

# Did Caddy get a certificate?
cd ~/infra && docker compose logs caddy --tail 50
```

If localhost answers but the public address times out, it's the firewall —
layer 1 first. Test from **outside** the box; a curl from the instance to its
own public hostname exercises a different path and can mislead.

> Use `curl -sv`, not `curl -s`. Plain `-s` silences errors, so a failure prints
> an empty line and looks like a mystery.

## 4. Install Docker

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

## 5. DNS

An **A record** for each hostname you'll serve, pointing at the instance's
public IP. Verify with `dig +short tools.rauhansheikh.com`.

## 6. Google OAuth

1. [Console](https://console.cloud.google.com/) → new project → **APIs &
   Services → Library → YouTube Data API v3 → Enable**
2. **OAuth consent screen**: External. Scopes `openid`, `email`,
   `https://www.googleapis.com/auth/youtube.readonly`
3. **Set publishing status to "In production".** In *Testing*, Google expires
   refresh tokens after **7 days** and the app breaks weekly.
4. **Credentials → OAuth client ID → Web application**, redirect URI
   `https://tools.rauhansheikh.com/api/auth/callback` — must match `APP_URL`
   exactly.

## 7. Bring up the shared proxy

Once, for the whole box. It owns the `edge` network, so it goes first.

```bash
# infra/ can live in its own repo; this copy ships inside the toolhub repo.
cp -r ~/toolhub/infra ~/infra
cd ~/infra
echo "ACME_EMAIL=you@example.com" > .env
docker compose up -d
docker compose logs -f caddy      # watch the certificate get issued
```

Sanity-check the config any time you edit a site file:

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## 8. Bring up the toolhub

```bash
cd ~/toolhub
cp .env.example .env && nano .env
```

Fill in `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`ALLOWED_EMAILS`, `METUBE_URL`, and a `SESSION_SECRET` from
`openssl rand -base64 32`.

```bash
mkdir -p downloads && sudo chown -R 1000:1000 downloads
docker compose up -d      # pulls the image built by CI; no compiling on the box
docker compose ps
```

## 9. Wire up CI/CD

`.github/workflows/deploy.yml` builds on a native **arm64** runner, pushes to
GHCR, then SSHes in to pull and restart. The VPS never compiles anything, so a
deploy doesn't fight your 2 OCPUs.

Generate a deploy key **on your laptop**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/toolhub_deploy -N "" -C "github-actions"
ssh-copy-id -i ~/.ssh/toolhub_deploy.pub ubuntu@<INSTANCE_IP>
cat ~/.ssh/toolhub_deploy        # private key — paste into the secret below
```

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
| --- | --- |
| `VPS_HOST` | instance public IP |
| `VPS_USER` | `ubuntu` |
| `VPS_SSH_KEY` | contents of `~/.ssh/toolhub_deploy` (the **private** key) |

No GHCR token needed on the box — the workflow forwards a short-lived,
job-scoped token for the pull and logs out afterwards.

Push to `main`, or run the workflow manually from the Actions tab. To roll back,
images are also tagged by commit SHA:

```bash
TOOLHUB_IMAGE=ghcr.io/rauhan-sheikh/toolhub:<sha> docker compose up -d web
```

## 10. Verify

```bash
# WARP tunnel up — this is what makes YouTube downloads work at all
cd ~/toolhub && docker compose exec warp curl -s https://www.cloudflare.com/cdn-cgi/trace | grep warp

# From your laptop, not the instance
curl -sv https://tools.rauhansheikh.com/api/health
```

Then in a browser: sign in → playlist tool → pick a **private** playlist → it
returns a duration. Downloader → paste a link → progress advances and the file
lands in `~/toolhub/downloads`.

If a download fails with *"Sign in to confirm you're not a bot"*, WARP isn't
routing — `docker compose restart warp metube`.

---

## Adding another project

Nothing about the proxy is toolhub-specific.

**A Dockerised project.** Join the shared network and don't publish ports:

```yaml
services:
  app:
    container_name: myproject-app
    networks: [edge]
networks:
  edge:
    name: edge
    external: true
```

Then `~/infra/sites/myproject.caddy`:

```
myproject.rauhansheikh.com {
	import common
	reverse_proxy myproject-app:3000
}
```

**A non-Docker project** — a systemd service, a static site, anything on a host
port. Bind it to `127.0.0.1` only, then:

```
myproject.rauhansheikh.com {
	import common
	reverse_proxy host.docker.internal:4000
}
```

Either way, add the DNS A record and reload:

```bash
cd ~/infra && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Caddy fetches the certificate on first request. See
`infra/sites/_example-non-docker.caddy.disabled` for a fuller template.
