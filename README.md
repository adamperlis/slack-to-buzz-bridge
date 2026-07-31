# slack-to-buzz-bridge

A free, open-source, multi-tenant bridge between **Slack** and
**[Buzz](https://github.com/block/buzz)** — Block's decentralized, self-hosted
workplace platform built on the open [Nostr](https://nostr.com) protocol.
Clients keep using Slack; your team (and its AI agents) live in Buzz. No
Slack Connect fees, no Zapier — one Node.js service and your Buzz hive.

```
Client Slack workspaces ──OAuth install──►  /slack/install
Client Slack messages   ──Events API────►  /slack/events ──► kind:9 (+h tag) ──► buzz-relay
Buzz replies            ◄──NIP-29 groups── buzz-relay ◄── your team & AI agents
                        └──► chat.postMessage back into the right Slack thread
```

## What it does

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

## Quick start (local)

```bash
npm install
cp .env.example .env   # Slack app credentials + BRIDGE_MASTER_KEY
npm start
npm test               # unit + integration suite (mock NIP-29 relay + mock Slack API)
```

Generate the master key (drives token encryption, the bridge's Nostr
identity, and per-user key derivation):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Slack app configuration

At [api.slack.com/apps](https://api.slack.com/apps):

- **Bot token scopes:** `chat:write`, `channels:history`, `channels:read`,
  `groups:history`, `users:read`
- **Redirect URL:** `https://<your-domain>/slack/oauth_redirect`
- **Event Subscriptions request URL:** `https://<your-domain>/slack/events`,
  with bot events `message.channels`, `message.groups`,
  `member_joined_channel`
- Enable public distribution (unlisted) so client workspaces can install.

## Connecting a channel

1. A client installs the app via `https://<your-domain>/login`.
2. Invite the bot to the shared Slack channel — the server logs the channel
   id and the exact mapping command.
3. Create (or pick) the Buzz channel and map them:

```bash
npm run map -- C0123456789 <buzz-channel-uuid> [team-id]
```

The running bridge picks up new mappings within 15 seconds. The bridge's
Nostr pubkey (printed at startup) must be allowed to publish on your Buzz
relay — add it to the relay's allowlist / channel membership.

## Deployment

The `deploy/` directory contains the full co-hosted stack for an Oracle
Cloud Always Free ARM instance: `Dockerfile` (arm64-native),
`docker-compose.yml` (Caddy + bridge + Buzz's relay/Postgres/Redis/MinIO
tier, with only Caddy exposed), `Caddyfile`, and `oci-setup.md` — a
step-by-step guide covering OCI's firewall traps, Docker port-publishing
pitfalls, and the lockdown verification gate. The deeper reasoning lives in
`docs/ARCHITECTURE-RESEARCH.md`.

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
