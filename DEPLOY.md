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

### Diagnosing "Caddy never gets a certificate"

Read the Caddy log before assuming it's the firewall — the two failure modes
look similar from outside but say very different things:

| Log says | Cause |
| --- | --- |
| `lookup ... on 127.0.0.53:53: connection refused` | Container DNS. See "Give Docker real DNS servers" above. |
| `timeout during connect` / challenge failures | Port 80 unreachable from outside — firewall, layer 1 first. |
| `could not determine zone` / NXDOMAIN | DNS A record missing or not propagated. |

Check what the container actually resolves with:

```bash
docker exec caddy cat /etc/resolv.conf
docker exec caddy nslookup acme-v02.api.letsencrypt.org
```

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

### Give Docker real DNS servers

**Do this before starting any container.** Ubuntu's `/etc/resolv.conf` points at
`127.0.0.53`, the systemd-resolved stub listener. That address is only meaningful
on the host — inside a container's network namespace it refers to the container's
own loopback, where nothing is listening. Every outbound lookup then fails with
`connection refused`, which surfaces as Caddy being unable to reach Let's
Encrypt, or MeTube being unable to resolve anything at all.

```bash
echo '{ "dns": ["1.1.1.1", "8.8.8.8"] }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Verify before moving on:

```bash
docker run --rm alpine nslookup acme-v02.api.letsencrypt.org
```

If that returns an address, container DNS is healthy. Daemon-wide rather than
per-service, since every project on this box needs it.

## 5. DNS

An **A record** for each hostname you'll serve, pointing at the instance's
public IP. Verify with `dig +short tools.rauhansheikh.com`.

## 6. Google OAuth

Google replaced the old "OAuth consent screen" page with **Google Auth
Platform**, split into Branding / Audience / Clients / Data access. Older guides
describe menus that no longer exist.

1. **APIs & Services → Library → YouTube Data API v3 → Enable.** Without this
   every playlist call returns 403, however good the OAuth setup is.

2. **APIs & Services → Google Auth Platform → Branding.** Set *App name* to
   something you'll recognise on the consent screen — it appears as "continue to
   <app name>". Leaving it as your email address works but reads oddly.

3. **→ Audience.** User type **External**.

   **Set publishing status to "In production".** This is the one that bites: in
   *Testing*, Google expires refresh tokens after **7 days**, so the app signs
   you out every week for no visible reason. "In production" without
   verification is fine for personal use — you click past a warning once, and
   the 100-user cap is irrelevant.

4. **→ Data access → Add or remove scopes.** Add `openid`, `email` (or
   `userinfo.email`), and `https://www.googleapis.com/auth/youtube.readonly`.
   The app requests exactly these; a missing YouTube scope means private
   playlists stay invisible.

5. **→ Clients → Create client → Web application.** Authorised redirect URI:

   ```
   https://tools.rauhansheikh.com/api/auth/callback
   ```

   It must match `APP_URL` exactly — scheme, host, path, no trailing slash.
   A mismatch shows as `Error 400: redirect_uri_mismatch`.

6. Copy the client ID and secret into `~/toolhub/.env`, then
   `docker compose up -d web` to pick them up.

### Checking it without signing in

```bash
# Follow our login redirect and see what Google makes of it
URL=$(curl -s -o /dev/null -w "%{redirect_url}" https://tools.rauhansheikh.com/api/auth/login)
curl -sL "$URL" | grep -oiE "redirect_uri_mismatch|invalid_client|Sign in with Google"
```

`Sign in with Google` means the client ID and redirect URI are accepted. This
cannot tell you the publishing status — check that in Audience.

### First sign-in

An unverified production app shows **"Google hasn't verified this app"**. Click
**Advanced → Go to <app name> (unsafe)**. It's your own app and your own
account; the warning only reflects that you haven't paid for a verification
review. It appears once per account.

## 7. Bring up the shared proxy

Once, for the whole box. It owns the `edge` network, so it goes first.

```bash
# infra/ can live in its own repo; this copy ships inside the toolhub repo.
# -T treats the destination as the directory itself. Without it, a second run
# copies into the existing ~/infra and you end up with ~/infra/infra.
cp -rT ~/toolhub/infra ~/infra
cd ~/infra
cp .env.example .env
```

Set a **real** email — Let's Encrypt uses it for expiry warnings, and ZeroSSL
(Caddy's fallback issuer) rejects obvious placeholders outright:

```bash
nano .env      # ACME_EMAIL=rauhan1998@gmail.com
```

```bash
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

## 10. Cloud Watch (Oracle billing monitor)

Reads tenancy-wide cost, Always Free headroom, budgets and every resource that
could bill. Needs no API key — the app authenticates as the instance itself.

**a. Tenancy OCID** into `~/toolhub/.env`. Read it off the VM rather than
hunting through the console:

```bash
curl -s -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/instance/   | grep -o '"tenantId"[^,]*'
```

Set `OCI_TENANCY_OCID` to that value, then
`docker compose up -d --force-recreate web`. It is an identifier, not a secret.

**b. Dynamic Group.** Identity & Security → Domains → Default → Dynamic groups
→ Create. Name `toolhub-monitor`, one matching rule:

```
instance.id = '<your instance OCID>'
```

The instance OCID comes from the same metadata call above (`"id"`).

**c. Policy.** Identity & Security → Policies → Create Policy, in the **root**
compartment, manual editor:

```
Allow dynamic-group 'Default'/'toolhub-monitor' to read usage-report in tenancy
Allow dynamic-group 'Default'/'toolhub-monitor' to read usage-budgets in tenancy
Allow dynamic-group 'Default'/'toolhub-monitor' to inspect all-resources in tenancy
```

> The budgets resource type is **`usage-budgets`**, not `budgets`. Using the
> latter fails with the unhelpful `API Error: No permissions found`.

Three separate reads: cost, budgets, inventory. Each degrades to a warning on
the page rather than blanking it, so a missing statement is visible.

**d. Budget alert.** Billing & Cost Management → Budgets → $1 monthly, alert
rule on **actual** spend at **1%**.

This is not optional garnish. OCI budgets are explicitly *soft* limits — they
notify and never block — but Oracle evaluates them every 24 hours and emails
you **even when your VM is down**, which is exactly when a dashboard on that VM
is useless. Cloud Watch renders a missing budget as a finding for that reason.

## 11. Verify

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
