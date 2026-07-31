# Hosting Guide — running the bridge yourself

This project is open source and nobody hosts it for you: every team runs
its own bridge. That's a feature — your Slack tokens and message traffic
never touch anyone else's servers. This guide covers the realistic hosting
options from $0 to fully managed.

## The three hard requirements

Whatever host you pick must provide all three, or the bridge can't work:

1. **Always-on process.** The bridge holds a live WebSocket subscription to
   your Buzz relay. Platforms that "scale to zero" or put idle apps to
   sleep will silently miss every Buzz→Slack message while asleep.
   This rules out serverless (Vercel/Netlify functions, Lambda) and
   free tiers that sleep.
2. **A persistent disk.** Workspace tokens, channel mappings, and the
   thread map live in a SQLite file. If the filesystem is wiped on each
   deploy, every workspace has to reinstall and threading history is lost.
3. **Public HTTPS.** Slack requires an HTTPS URL for OAuth and event
   delivery. VPS setups get this from Caddy (automatic Let's Encrypt);
   managed platforms provide it automatically.

It also needs *outbound* WebSocket access to your Buzz relay — every host
below allows that.

## Which option is right for you?

| Option | Cost | Effort | Notes |
|---|---|---|---|
| **Oracle Cloud Always Free** | $0 | High (one-time) | The 100%-free path; can co-host Buzz itself. See [`deploy/oci-setup.md`](../deploy/oci-setup.md) |
| **Any VPS** (Hetzner, DigitalOcean, Lightsail…) | ~$4–6/mo | Medium | Simplest mental model; steps below |
| **Render** | ~$7/mo + disk | Low | Paid instance required — the free tier sleeps after 15 min and can't attach a disk, which breaks requirements 1 and 2 |
| **Fly.io** | ~$3–5/mo | Low-medium | Small always-on machine + volume |
| **Railway** | usage-based (~$5/mo) | Low | Dockerfile deploy + volume |
| ❌ Vercel / Netlify / Cloudflare Workers | — | — | Serverless: no long-lived WebSocket, no disk. Not usable |

Prices are mid-2026 ballparks — check current pricing before committing.

One more decision: **where is your Buzz hive?** If your team already hosts
Buzz somewhere, the bridge can live anywhere that reaches the relay URL.
If you're standing up both from scratch on one machine, use the co-hosted
stack in [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) and
follow the OCI guide (it applies to any Ubuntu VPS, not just Oracle —
skip the OCI-specific firewall sections on other providers).

---

## Option A — Any Linux VPS with Docker (recommended default)

Works on Hetzner (~€4/mo), DigitalOcean, Vultr, AWS Lightsail, or any
Ubuntu/Debian box. You need a domain (or subdomain) pointed at the
server's IP — an `A` record like `bridge.yourdomain.com → <server-ip>`.

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sudo sh

# 2. Get the code and configure
git clone https://github.com/adamperlis/slack-to-buzz-bridge.git
cd slack-to-buzz-bridge
cp .env.example .env && chmod 600 .env
nano .env   # fill in Slack credentials, PUBLIC_BASE_URL, BUZZ_RELAY_URL, BRIDGE_MASTER_KEY

# 3. Set your domain in the bridge-only Caddyfile
nano deploy/Caddyfile.bridge-only   # replace bridge.example.com

# 4. Launch (Caddy fetches a Let's Encrypt certificate automatically)
cd deploy
docker compose -f docker-compose.bridge-only.yml up -d --build
```

Then finish the Slack app setup from the README's beginner guide using
`https://bridge.yourdomain.com` as your address. Check health with
`curl https://bridge.yourdomain.com/healthz`.

Updating later: `git pull && docker compose -f docker-compose.bridge-only.yml up -d --build`.
Back up the `bridge_data` volume (the SQLite file) on a schedule; the
tokens inside are encrypted, so backups are useless without your
`BRIDGE_MASTER_KEY` — keep that only in `.env` and a password manager.

## Option B — Oracle Cloud Always Free ($0)

The full walkthrough, including Oracle's firewall traps and the co-hosted
Buzz stack, is in [`deploy/oci-setup.md`](../deploy/oci-setup.md). Summary:
upgrade the account to Pay As You Go (still $0 within free limits, avoids
idle reclamation), open ports 80/443 in both the VCN security list and the
VM's iptables, install Docker, and run the compose stack. Expect capacity
retries when launching the free ARM instance, and note the free allowance
shrank to ~2 OCPU / 12 GB in mid-2026.

## Option C — Render (managed, easiest — one-click)

Click **Deploy to Render** in the README (or open
`https://render.com/deploy?repo=https://github.com/adamperlis/slack-to-buzz-bridge`).
The repo's `render.yaml` blueprint does the setup for you: Docker build,
1 GB persistent disk at `/app/data`, `/healthz` health check, and
auto-generated `BRIDGE_MASTER_KEY` + `SLACK_STATE_SECRET`. Render's form
prompts for the only four values it can't invent: `SLACK_CLIENT_ID`,
`SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, and `BUZZ_RELAY_URL`.

The **free tier will not work** — free web services spin down after 15
idle minutes and cannot attach persistent disks — so the blueprint pins
the Starter plan (~$7/mo) plus the disk. Render terminates TLS and
injects the public URL (`RENDER_EXTERNAL_URL`), which the bridge picks up
automatically — no `PUBLIC_BASE_URL` to configure. Use the assigned
`https://….onrender.com` address in your Slack app's redirect/events
URLs.

## Option D — Fly.io

A ready `fly.toml` ships in the repo root (Docker build, `/app/data`
volume mount, `/healthz` check, and — critical — always-on machines so
the relay WebSocket never drops):

```bash
fly launch --copy-config --no-deploy   # keeps the repo's fly.toml
fly volumes create bridge_data --size 1
fly secrets set SLACK_CLIENT_ID=… SLACK_CLIENT_SECRET=… \
  SLACK_SIGNING_SECRET=… BUZZ_RELAY_URL=… \
  BRIDGE_MASTER_KEY=$(openssl rand -hex 32)
fly deploy
```

The bridge derives its public URL from the Fly app name automatically.

## Option E — Railway

**New Project → Deploy from GitHub repo** — the repo's `railway.json`
sets the Docker build and health check automatically. Attach a **volume**
mounted at `/app/data`, set `BRIDGE_DB=/app/data/bridge.sqlite` plus the
four Slack/Buzz variables and a `BRIDGE_MASTER_KEY`, and enable a public
domain — the bridge picks the domain up automatically. Railway bills by
usage; a small always-on service typically lands around $5/mo.

---

## After deploying, whatever the host

1. Update the Slack app's **Redirect URL** and **Events Request URL** to
   the new public address (they must match `PUBLIC_BASE_URL` exactly).
2. Re-run the lockdown check: only 80/443 (or the platform's HTTPS
   endpoint) should be reachable from the internet.
3. Put an uptime monitor on `/healthz` (free: UptimeRobot) — it returns
   relay connectivity and the mapped-channel count.
