# slack-to-buzz-bridge

> [!WARNING]
> **⚠️ Experimental — not yet tested against a live deployment. Use with
> caution.** This bridge has a passing automated test suite (including an
> integration run against a mock relay that enforces Buzz's documented
> wire format), but it has **not** yet been validated against a real,
> running Buzz relay or used in production with real Slack workspaces.
> Buzz itself is brand new and evolving quickly, so its protocol details
> may shift. Test thoroughly in a sandbox before trusting it with client
> conversations, and expect rough edges. Bug reports are very welcome.

## What is this?

**The short version — the problem:** you're paying Slack for a seat for
every person on your team — plus **Slack Connect**, the paid feature for
sharing channels with clients — mostly so you can talk to clients who live
in Slack and will never leave it. You can't quit Slack without losing your
clients, and you can't stop paying while your team is on it.
**The fix:** move your team to **Buzz** (a free, open-source team chat you
host yourself), and let this bridge relay messages both ways — so clients
keep chatting in Slack like always, your team replies from Buzz, and
neither side notices anything changed. Everything installs on **your**
side: clients never add an app, approve anything, or change how they work. The section
[below](#what-youre-paying-slack-today--and-what-this-changes) details
exactly which Slack costs this removes and how to downgrade.

There's a second problem it quietly solves too: on Slack, every client
conversation your business depends on lives on someone else's servers, on
someone else's terms. Self-hosting means your message history is yours.

**[Buzz](https://github.com/block/buzz)** is a new, free, open-source team
chat platform from Block (Jack Dorsey's company). You run it yourself, you
own your data, it costs nothing per seat, and it's built for teams that
work alongside AI agents.

This bridge connects the two. You set it up once, and then:

- A client types a message in your shared Slack channel → it appears in
  your team's Buzz channel seconds later, with their name on it.
- Your teammate (or your AI agent) replies in Buzz → it shows up back in
  the Slack channel, in the right thread.
- **Your clients never know the difference.** They just see replies in
  Slack like always. Meanwhile your team stopped paying for Slack.

**Where does it run?** The bridge is its own small program — it doesn't
install into Slack or into Buzz. It's a messenger that sits between them:
Slack sends it messages over the web, and it passes them to your Buzz
server (and back). You run it on a server you control — either right next
to Buzz on the same machine, or anywhere else that can reach both. Nobody
hosts it for you and nobody sees your messages; there's a $0 hosting
option, and it's free forever because it's open source.

## What you're paying Slack today — and what this changes

To be precise about the money, here's how Slack's pricing actually works
for talking to people outside your company, and what the bridge changes.

**How Slack Connect works today.** Slack Connect is Slack's feature for
sharing a channel between two *different* companies. The billing rules
have real nuance, so here they are exactly:

- **The standard rule:** every organization in a Slack Connect channel is
  on a paid plan (Pro, currently ~$7.25/user/month billed annually, or
  higher). A free workspace can't *start* a Slack Connect channel, ever.
- **"But I was invited for free!"** Two real exceptions explain this:
  1. A free team invited by a paid org can accept via a **one-time 90-day
     Pro trial** (no credit card). When the trial ends, that workspace has
     to pay to keep participating — and the trial applies once per
     workspace, ever.
  2. If the inviting company is on **Enterprise Grid** (Slack's big-company
     tier), free teams can join channels in *that org* indefinitely without
     paying — it's a Grid admin setting, on by default. Genuinely free, but
     only while a Grid-level client is hosting you, under their settings.
- Guest accounts (including "free" single-channel guests) are a paid-plan
  feature too: only a paid workspace can host guests.

So yes — if a paid customer invites you, it can genuinely be free. But
look at what that free ride depends on:

- **If your client is on Pro or Business+** (the typical agency
  situation): your free access is really a 90-day countdown. When the
  trial expires, you either start paying for every teammate in the channel
  or you lose it — and you only ever get that trial once per workspace.
- **If your client is on Enterprise Grid**: it's free for as long as
  (a) that client stays big enough to be paying for Grid, (b) their
  admins keep the "free teams can join" setting switched on, and (c)
  you're okay with each client relationship living inside *their* org,
  under *their* settings. Your access is a toggle in someone else's
  admin panel.
- **In every case**, your team is still living in Slack on the free plan's
  limits — most painfully, messages older than 90 days become invisible,
  which for client work means your project history is constantly
  evaporating.

**At a glance — what does talking to each client cost you?** The Slack
Connect column assumes the best case for Slack: your team downgraded to
Slack's free plan and stays in Slack. The bridge column is a different
world: your team isn't on Slack at all, so *your* Slack plan stops being
a question that exists.

| Your client's Slack plan | Slack Connect (your team on Slack, free plan) | This bridge (your team on Buzz, no Slack) |
|---|---|---|
| **Enterprise Grid** (big-company tier) | ✅ Free indefinitely — *but* only while their admins keep the "free teams can join" setting on, and you work inside their org | ✅ Free — client installs the app in their own workspace |
| **Pro or Business+** (typical paid team) | ⏳ Free for 90 days (one-time trial per workspace), then **~$7.25+/month for every teammate** in the channel — or you lose access | ✅ Free — same, nothing changes by their tier |
| **Free plan** | ❌ Impossible — Slack Connect requires paid plans, so you can't share a channel with them at all | N/A — there's no Slack Connect setup to replace here (the bridge does still work with free-plan workspaces, if you ever need it) |

And the Slack Connect column carries a hidden cost in every row: your
team still lives under Slack's free-plan limits, with project history
vanishing after 90 days. The bridge column's requirement is one install —
normally by **you, into your own workspace** (see "how you wire it up"
below); a client-side install is the fallback for clients who'll click
once.

**What the bridge changes — how you wire it up.**

**The main setup — you install it, in your own workspace; clients do
nothing.** This is the whole point of the bridge: you can't ask clients
to install apps, and you shouldn't have to. You keep (or create) a free
Slack workspace, stay in the **Slack Connect channels your clients have
already invited you to**, and install the bridge into *your* workspace —
then invite the bot into each shared channel from your side. Slack's app
model supports this: a bot sees and posts messages in a Slack Connect
channel for members of both organizations. The client approves nothing,
installs nothing, and notices nothing; your team reads and replies from
Buzz. Your Slack cost is whatever keeps you in those Connect channels —
which is the point of the table above: **$0 indefinitely under
Enterprise Grid clients**, the 90-day trial under Pro/Business+ clients,
and paid after that.

**The fallback — the client installs it (one click).** If a client *is*
willing to click "Add to Slack" once, the bridged channel can instead be
a regular channel inside their own workspace. That removes the Slack
Connect dependency entirely — you then need no Slack workspace at all,
and it's the only route for clients on Slack's free plan (who can't be
in Connect channels). Worth offering to clients you're closest to.

| | Who acts | Slack Connect involved? | Your Slack cost |
|---|---|---|---|
| **Main setup** | You: install + invite bot | Yes — your existing shared channels | Free workspace (Grid clients; or 90-day trial); paid after |
| **Fallback** | Client: one click | No — plain channel in their workspace | None — you need no Slack at all |

(One free-plan caveat that applies to whichever workspace hosts the app:
free workspaces are limited to about 10 app integrations, and the bridge
counts as one.)

**How to actually wind down your Slack bill.** If you're currently on a
paid plan with Slack Connect channels, the migration looks like this:

1. For each client, ask them to create a **regular channel in their own
   workspace** and install the bridge there (one click on your `/login`
   page), replacing the Slack Connect channel.
2. **Export your Slack history first** (Workspace Settings → Import/Export)
   — the bridge archives everything *from the day it's installed onward*
   into Buzz, but it can't reach back in time, and downgrading to Slack's
   free plan hides messages older than 90 days.
3. Once every client channel has moved, **downgrade your workspace to the
   free plan** (Billing → change plan) or close it entirely. Your team's
   day-to-day moves to Buzz; the bridge keeps the client conversations
   flowing.

The honest summary: the bridge doesn't make Slack Connect cheaper — it
makes it *unnecessary*, by moving the shared channel into the client's
workspace where no cross-organization sharing (and no paid plan on your
side) is involved. Even in the cases where Slack Connect is free for you —
the 90-day trial, or an Enterprise Grid client hosting you — the bridge
still buys you out of the parts that aren't about money: your team living
in Slack's free-plan limits, and your client relationships depending on a
trial clock or another company's admin settings.

## Setup guide (beginner friendly)

This walks you from nothing to a working bridge, step by step. No prior
experience with Slack apps or Nostr needed. Budget 30–45 minutes.

The whole journey at a glance:

1. **Get it running** — one command creates your config file.
2. **Create your Slack app** — clicking through Slack's settings pages.
3. **Install it into a workspace** — one click on an "Add to Slack" button.
4. **Connect a Slack channel to a Buzz channel** — one command.
5. **Test it** — send a message each way.

### What you'll need

- **A computer with Node.js 18 or newer.** Get it from
  [nodejs.org](https://nodejs.org) — download the "LTS" installer, run it,
  accept the defaults. To check it worked, open a terminal (Terminal on
  Mac, PowerShell on Windows) and type `node --version`.
- **A Slack workspace where you're an admin** (a free one is fine — create
  one at [slack.com/create](https://slack.com/create) to practice).
- **A running Buzz hive** — yours or your team's. Buzz is free and
  self-hostable: [github.com/block/buzz](https://github.com/block/buzz).
- **A public HTTPS address for the bridge.** Slack refuses to talk to plain
  `http://localhost`. For a real deployment use a domain + server (see
  [Deployment](#deployment--you-host-it-yourself)); to just try it out, a
  free tunnel works:
  install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  and run `cloudflared tunnel --url http://localhost:3000` — it prints a
  public `https://…trycloudflare.com` address that forwards to your machine.

### Step 1 — Get it running

The easiest path needs no download at all — `npx` fetches and runs it:

```bash
mkdir my-bridge && cd my-bridge
npx slack-to-buzz-bridge init    # creates .env with a generated master key
```

`init` writes a `.env` config file and generates your **master key** (the
secret that encrypts stored Slack tokens and signs the bridge's messages)
for you. Open `.env` in any text editor — you'll fill in the Slack values
in the next step. **Treat the file like a password — never share or commit
it.**

Later, `npx slack-to-buzz-bridge` starts the bridge and
`npx slack-to-buzz-bridge map …` connects channels.

<details>
<summary>Prefer a git checkout? (contributors, or before the npm package is published)</summary>

```bash
git clone https://github.com/adamperlis/slack-to-buzz-bridge.git
cd slack-to-buzz-bridge
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # → BRIDGE_MASTER_KEY
npm start        # instead of: npx slack-to-buzz-bridge
npm run map --   # instead of: npx slack-to-buzz-bridge map
```

`npx github:adamperlis/slack-to-buzz-bridge` also works directly from
GitHub once the repo is public, with no npm publish needed.
</details>

### Step 2 — Create your Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and sign in.
2. Click **Create New App → From scratch**. Name it (e.g. "Buzz Bridge"),
   pick your workspace, click **Create App**.
3. In the left sidebar, open **OAuth & Permissions**:
   - Under **Scopes → Bot Token Scopes**, click **Add an OAuth Scope** and
     add all five: `chat:write`, `channels:history`, `channels:read`,
     `groups:history`, `users:read`.
   - Under **Redirect URLs**, click **Add New Redirect URL** and enter
     `https://YOUR-ADDRESS/slack/oauth_redirect` (your domain or tunnel
     address). Click **Save URLs**.
4. Open **Basic Information**. Under **App Credentials**, copy three values
   into your `.env` file: **Client ID** → `SLACK_CLIENT_ID`,
   **Client Secret** → `SLACK_CLIENT_SECRET`, and **Signing Secret** →
   `SLACK_SIGNING_SECRET`.
5. Also in `.env`, set `PUBLIC_BASE_URL=https://YOUR-ADDRESS` and
   `BUZZ_RELAY_URL` to your Buzz relay's WebSocket address (for example
   `wss://buzz.yourcompany.com`).
6. Start the bridge — it must be running and publicly reachable before the
   next click:

   ```bash
   npx slack-to-buzz-bridge
   ```

7. Back in the Slack app settings, open **Event Subscriptions**:
   - Toggle **Enable Events** on.
   - In **Request URL**, enter `https://YOUR-ADDRESS/slack/events`. Slack
     pings it instantly — you should see a green **Verified ✓**. (Red?
     The bridge isn't running or the address isn't reachable.)
   - Expand **Subscribe to bot events**, click **Add Bot User Event**, and
     add: `message.channels`, `message.groups`, `member_joined_channel`.
   - Click **Save Changes**.
8. Open **Manage Distribution** and activate **Public Distribution** — this
   is what lets *other* workspaces (your clients) install the app. The app
   does not need to be listed in the Slack Marketplace.

   **Is that safe?** Installing the app only ever connects the installer's
   *own* workspace — Slack tokens are workspace-scoped, so no installer can
   see anyone else's Slack. The residual concern is strangers connecting
   *their* workspace to *your* server if the link leaks. Two protections:
   messages never bridge from channels you haven't explicitly mapped, and
   once you know your clients' workspace IDs you should set
   `SLACK_ALLOWED_TEAMS` in `.env` — installs from any other workspace are
   then rejected outright.

### Step 3 — Install it into your workspace

Open `https://YOUR-ADDRESS/login` in a browser and click **Add to Slack**,
then **Allow** — installing it into **your own workspace** (the one that's
in the Slack Connect channels with your clients). That's the whole
install: one person, one click, one time. The bridge stores the
workspace's access token encrypted.

Because the app lives in *your* workspace, your clients approve nothing
and install nothing — in the next step you'll simply invite the bot into
the shared channels from your side. Your teammates also install nothing
anywhere; they just use Buzz.

**Fallback for app-friendly clients:** the same `/login` link works in a
client's workspace too. If a client is happy to click "Add to Slack" once,
the channel can live in their workspace instead — which removes the Slack
Connect dependency for that client entirely (see
["how you wire it up"](#what-youre-paying-slack-today--and-what-this-changes)).

### Step 4 — Connect a Slack channel to a Buzz channel

1. In Slack, open the channel you want to bridge — typically the **Slack
   Connect channel you share with a client** — and invite the bot:
   type `/invite @Buzz Bridge` (or whatever you named it).
2. Look at the bridge's terminal — it logs the channel's ID and the exact
   command to run.
3. In Buzz, create (or pick) the channel that should mirror it, and copy
   its channel ID (a UUID, visible in the channel's settings/URL).
4. Run the mapping command:

   ```bash
   npx slack-to-buzz-bridge map C0123456789 your-buzz-channel-uuid
   ```

The running bridge picks up new mappings within 15 seconds — no restart.

One more thing on the Buzz side: when it starts, the bridge prints its
**Nostr pubkey** — its identity in Buzz. A Buzz admin allows that pubkey
on the relay and adds it as a member of each bridged channel, the same way
you'd add any teammate.

**Who has to do this?** One Buzz admin, once. Your teammates set up
nothing — if they're in the bridged Buzz channel, they see client messages
appear and their replies flow back to Slack automatically. To them the
bridge is just one more channel member.

### Step 5 — Test it

Type a message in the Slack channel → it should appear in the Buzz channel
within a second or two, prefixed with the sender's name. Reply from Buzz →
it appears back in Slack. Reply *in a thread* on either side → it lands in
the matching thread on the other side.

### If something doesn't work

| Symptom | Likely cause |
|---|---|
| Event Subscriptions URL won't verify | Bridge not running, or `PUBLIC_BASE_URL`/tunnel address wrong |
| "Add to Slack" errors after clicking Allow | Redirect URL in Slack app settings doesn't exactly match `PUBLIC_BASE_URL` + `/slack/oauth_redirect` |
| Slack messages don't reach Buzz | Channel not mapped (step 4), or relay rejected the bridge's pubkey — check the terminal for `auth-required`/`restricted` errors |
| Buzz messages don't reach Slack | Mapping missing, or the bot was never invited to the Slack channel |
| Bridge exits immediately at start | A required `.env` value is missing — the error message names it |

## How it works, slightly more technically

```
Client Slack workspaces ──OAuth install──►  /slack/install
Client Slack messages   ──Events API────►  /slack/events ──► kind:9 (+h tag) ──► buzz-relay
Buzz replies            ◄──NIP-29 groups── buzz-relay ◄── your team & AI agents
                        └──► chat.postMessage back into the right Slack thread
```

A multi-tenant OAuth bridge: any number of client workspaces install a
"Sign in with Slack" app, and one Node.js service relays messages both
ways between Slack channels and Buzz channels over the open
[Nostr](https://nostr.com) protocol.

## Under the hood

- **Multi-tenant OAuth** — any number of client workspaces install via a
  "Sign in with Slack" page; per-workspace bot tokens are stored
  **encrypted at rest** (AES-256-GCM, tenant-bound) in SQLite.
- **Speaks Buzz's actual protocol** — NIP-29 `kind:9` chat messages with the
  required `h` tag, NIP-42 relay authentication, and NIP-10 marked reply
  tags. Verified against Buzz's published wire format.
- **Threading, both directions** — Slack `thread_ts` maps to Nostr reply
  tags and back; a reply in either system lands in the right thread in the
  other.
- **High-fidelity formatting** — parses Slack `rich_text` blocks (lists,
  quotes, code, mentions) and converts emoji using the same
  [emoji-data](https://github.com/iamcal/emoji-data) set Slack itself uses.
- **Echo-loop prevention by cryptography** — the bridge skips events signed
  by its own keys (pubkey check), plus the `[Slack -` content guard and
  Slack-side `bot_id` filtering.
- **Attribution** — Buzz authors appear in Slack by their kind:0 profile
  name; Slack authors appear in Buzz by real name, or (in `per-user` key
  mode) as individual derived Nostr identities that support native
  deletions.

## Deployment — you host it yourself

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/adamperlis/slack-to-buzz-bridge)

The fastest path: click the button above — the repo's `render.yaml`
blueprint provisions the service, a persistent disk, and generated
secrets; you type only your four Slack/Buzz values into Render's form
(~$7/mo + disk, since Render's free tier sleeps). Ready-made configs for
Fly.io (`fly.toml`) and Railway (`railway.json`) are in the repo root too.
On all three platforms the bridge auto-detects its public URL, so
`PUBLIC_BASE_URL` never needs typing.

For the **$0 route**, `deploy/oci/` is a complete Oracle Cloud Resource
Manager stack (upload, fill a form, Apply — it builds the free ARM
instance, firewall, TLS, and bridge in one shot), and
`deploy/setup-vps.sh` bootstraps any ordinary Ubuntu VPS in one command.

| Host | Monthly cost | Deploy experience |
|---|---|---|
| Oracle Cloud free tier | **$0** | Upload stack zip → fill form → Apply |
| Render | ~$7 + disk | ✅ One-click button |
| Fly.io | ~$3–5 | Config included, 4 CLI commands |
| Railway | ~$5 usage-based | Config included + dashboard clicks |
| Any VPS | ~$4–6 | One bootstrap command, edit 2 files |

Full comparison, requirements, and per-host steps: [docs/HOSTING.md](docs/HOSTING.md).

Nobody hosts this for you: every team runs its own bridge, so your Slack
tokens and message traffic never touch anyone else's servers.
**[docs/HOSTING.md](docs/HOSTING.md)** compares the realistic options —
any $4–6/mo VPS with Docker (recommended default), Oracle Cloud's Always
Free tier ($0), and managed platforms (Render, Fly.io, Railway) — and
explains the three hard requirements (always-on process, persistent disk,
public HTTPS) that rule out serverless hosts and sleeping free tiers.

The `deploy/` directory has everything ready to run:

- `docker-compose.bridge-only.yml` + `Caddyfile.bridge-only` — standalone
  bridge for teams whose Buzz hive lives elsewhere
- `docker-compose.yml` + `Caddyfile` — full co-hosted stack (Caddy +
  bridge + Buzz's relay/Postgres/Redis/MinIO tier, only Caddy exposed)
- `Dockerfile` — arm64-native container build
- `oci-setup.md` — step-by-step Oracle Cloud guide, covering OCI's
  firewall traps, Docker port-publishing pitfalls, and the lockdown
  verification gate

The deeper reasoning lives in `docs/ARCHITECTURE-RESEARCH.md`.

## Configuration reference

| Variable | Purpose |
|---|---|
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_SIGNING_SECRET` | Slack app credentials |
| `SLACK_STATE_SECRET` | OAuth CSRF state secret (set your own in production) |
| `PUBLIC_BASE_URL` | Public HTTPS base URL of this server |
| `BUZZ_RELAY_URL` | WebSocket URL of your Buzz relay |
| `BRIDGE_MASTER_KEY` | 32-byte hex master secret (encryption + signing) |
| `BRIDGE_KEY_MODE` | `single` (default) or `per-user` derived identities |
| `SLACK_ALLOWED_TEAMS` | Comma-separated team IDs allowed to install (empty = anyone with the link) |
| `BRIDGE_DB` | SQLite path (default `./data/bridge.sqlite`) |
| `PORT` | HTTP port (default 3000) |

Upgrading from the v1 flat-file version: on first boot the server migrates
`database.json` into SQLite (tokens become encrypted) and renames the old
file to `database.json.migrated`.

## Relationship to Buzz

Buzz has no plugin store — by design. Its extension surface *is* the open
Nostr protocol, and this bridge integrates the native way: as an
authenticated Nostr client speaking NIP-29 to your relay. Nothing needs to
be installed inside Buzz itself. This project is independent and not
affiliated with Block, Inc.

## Contributing & security

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). For
security-sensitive reports see [SECURITY.md](SECURITY.md); please don't file
public issues for vulnerabilities. Deployers should read the security
properties in SECURITY.md — in particular: anything bridged to a relay you
don't control is world-readable, and AI agents consuming the relay stream
must treat bridge-originated content as untrusted data (key off the bridge's
signing pubkey, never message text).

## License

[MIT](LICENSE)
