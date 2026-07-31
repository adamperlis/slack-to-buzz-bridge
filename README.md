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
every person on your team, mostly so you can talk to clients who live in
Slack and will never leave it. You can't quit Slack without losing your
clients, and you can't stop paying while your team is on it.
**The fix:** move your team to a free chat platform you own, and let this
bridge relay messages both ways — so clients keep chatting in Slack like
always, your team replies from the free side, and neither one notices
anything changed.

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

## Setup guide (beginner friendly)

This walks you from nothing to a working bridge. No prior experience with
Slack apps or Nostr needed. Budget 30–45 minutes.

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
  [Deployment](#deployment)); to just try it out, a free tunnel works:
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

### Step 3 — Install it into a workspace

Open `https://YOUR-ADDRESS/login` in a browser and click **Add to Slack**,
then **Allow**. That's the whole install flow — the same link works for
your clients, in their own workspaces. The bridge stores each workspace's
access token encrypted.

**Who has to do this?** Exactly one person per Slack workspace, one time.
The install is workspace-level: it adds a single bot for everyone, so
teammates and clients in the channel never install anything themselves.
(The clicker needs permission to install apps in their workspace — in many
workspaces any member can; some restrict it to admins.) And your own
internal team installs nothing anywhere — they just use Buzz.

### Step 4 — Connect a Slack channel to a Buzz channel

1. In Slack, open the channel you want to bridge and invite the bot:
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
**Nostr pubkey**. Your Buzz relay must allow that pubkey to post — add it
to the relay's allowlist and/or the Buzz channel's members (your Buzz
admin does this once).

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

## Deployment — you host it yourself

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
