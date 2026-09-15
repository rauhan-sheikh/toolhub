# Deploying the toolhub to Oracle Cloud

Target: one Ampere A1 instance running four containers — Caddy (TLS), the
Next.js app, MeTube (yt-dlp engine), and Cloudflare WARP (egress proxy).

Your account is **Pay As You Go**, so Always Free resources stay free but
nothing stops you provisioning billable ones. Section 1 is about not doing that.

---

## 1. Stay free (do this first)

Oracle charges only for usage **above** the Always Free limits. The limits that
matter here:

| Resource | Always Free allowance | What to pick |
| --- | --- | --- |
| Ampere A1 compute | 1,500 OCPU-hrs + 9,000 GB-hrs / month | **2 OCPU / 12 GB**, one instance |
| Block storage (boot + block) | **200 GB total** | one 100 GB boot volume |
| Outbound transfer | 10 TB / month | irrelevant at personal scale |
| Public IP | included with the instance | 1 ephemeral or reserved |

> **Ampere was halved.** Oracle cut Always Free A1 from 4 OCPU / 24 GB to
> **2 OCPU / 12 GB** on 15 June 2026. Most guides still quote the old number —
> asking for 4 OCPU now means paying for two of them.

Two OCPU and 12 GB works out to 1,460 OCPU-hrs and 8,760 GB-hrs over a 730-hour
month, which sits just under both caps. Do not run a second A1 instance
alongside it.

**Set a budget alert before creating anything.** This is the real safety net:

1. Console → **Billing & Cost Management** → **Budgets** → **Create Budget**
2. Target: your root compartment, monthly amount **$1**
3. Add an alert rule: **Actual** spend, threshold **1%**, your email
4. Confirm it shows as **Active**

Then, while provisioning, look for the **"Always Free-eligible"** label in the
console — Oracle marks qualifying options explicitly. If a shape or volume
doesn't carry it, it bills.

Check **Billing → Cost Analysis** 48 hours after you finish. It should read
$0.00. One thing to know if it doesn't: block volumes default to the
**Balanced (VPU 10)** performance level, and VPU is billed separately from
capacity. You can drop a volume to **Lower Cost (VPU 0)** at any time with no
downtime and no re-create.

---

## 2. Create the instance

Console → **Compute** → **Instances** → **Create instance**.

- **Image**: Canonical Ubuntu 24.04 (make sure it's the **aarch64** build)
- **Shape**: Change shape → **Ampere** → `VM.Standard.A1.Flex` →
  **2 OCPUs**, **12 GB** memory
- **Boot volume**: tick "Specify a custom boot volume size" → **100 GB**
  (leaves headroom under the 200 GB cap; downloads live here)
- **Networking**: create a new VCN, **assign a public IPv4 address**
- **SSH keys**: upload your public key (`~/.ssh/id_ed25519.pub`), or let Oracle
  generate one and save the private key immediately

> **"Out of host capacity"** on Ampere is common. It isn't a billing problem —
> retry, switch availability domain, or try again later. It does not mean you
> need a paid shape.

Note the public IP once it boots.

## 3. Open the firewall — both layers

Oracle blocks ports in **two** places. Missing the second is the single most
common reason a fresh instance seems unreachable.

**Layer 1 — VCN security list.** Networking → Virtual Cloud Networks → your VCN
→ Subnet → Security List → **Add Ingress Rules**:

| Source CIDR | Protocol | Dest. port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

**Layer 2 — the instance's own iptables.** Oracle's Ubuntu images ship with
rules that drop everything except SSH. SSH in and persist an exception:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Do **not** open 8081 (MeTube) or 1080 (WARP). They stay on the internal Docker
network by design.

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

## 5. Point a domain at it

Create an **A record** for your domain (e.g. `tools.yourdomain.com`) pointing at
the instance's public IP. Caddy needs this resolving before it can get a
certificate. Verify with `dig +short tools.yourdomain.com`.

## 6. Configure Google OAuth

In the [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project, then **APIs & Services → Library → YouTube Data API v3 →
   Enable**
2. **OAuth consent screen**: External. Add scopes `openid`, `email`, and
   `https://www.googleapis.com/auth/youtube.readonly`
3. **Publish the app — set publishing status to "In production".**
   In *Testing*, Google expires refresh tokens after **7 days** and the app will
   silently stop working every week. In production, unverified just means
   clicking through a warning once; the 100-user cap is irrelevant here.
4. **Credentials → Create Credentials → OAuth client ID → Web application**
   - Authorised redirect URI: `https://tools.yourdomain.com/api/auth/callback`
     (must match `APP_URL` exactly, including scheme and no trailing slash)
5. Copy the client ID and secret.

## 7. Deploy

```bash
git clone <your-repo-url> toolhub && cd toolhub
cp .env.example .env
nano .env
```

Fill in `APP_URL`, `APP_DOMAIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`ALLOWED_EMAILS`, and a `SESSION_SECRET` from:

```bash
openssl rand -base64 32
```

Then bring it up — the first build takes a few minutes on 2 OCPUs:

```bash
mkdir -p downloads && sudo chown -R 1000:1000 downloads
docker compose up -d --build
docker compose ps
```

## 8. Verify

```bash
# WARP tunnel is up — this is what makes YouTube downloads work at all
docker compose exec warp curl -s https://www.cloudflare.com/cdn-cgi/trace | grep warp

# App is healthy
curl -s https://tools.yourdomain.com/api/health
```

Then in a browser:

1. Visit the domain → redirected to `/login`
2. Sign in with an allowed account → tool grid
3. Playlist tool → "pick from my playlists" → choose a **private** one → it
   returns a duration
4. Downloader → paste a YouTube link → progress advances and the file appears
   in `./downloads`

If a download fails with *"Sign in to confirm you're not a bot"*, WARP isn't
routing. Recheck step 8's first command; `docker compose restart warp metube`
usually settles it.

## Updating

```bash
git pull && docker compose up -d --build
```

## Notes

- WARP is a workaround, not a guarantee. Google tightens bot detection
  periodically; if downloads start failing, the egress path is the first place
  to look. Nothing in the app code depends on it — it's compose configuration.
- Downloads accumulate in `./downloads` on the boot volume. Keep an eye on disk
  usage so total storage stays under the 200 GB free allowance.
