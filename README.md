# slack-to-buzz-bridge

A free, open-source, multi-tenant bridge between **Slack** and **Buzz** (the
decentralized workplace platform built on the open [Nostr](https://nostr.com)
protocol). Clients keep using Slack on their side; your internal team runs
entirely out of Buzz. No Slack Connect fees, no Zapier/Make accounts — just a
tiny Node.js process and a Nostr relay.

```
Client Slack channel  ──(Events API)──►  Bridge Bot  ──(signed Nostr event)──►  Buzz room
Client Slack channel  ◄──(chat.postMessage)──  Bridge Bot  ◄──(relay subscription)──  Buzz room
```

## How it works

- **Slack ➔ Buzz** — the bot listens to messages in every mapped channel,
  resolves the author's real name, converts Slack mrkdwn + `:emoji:`
  shortcodes to plain unicode text, wraps it in a Nostr kind-1 event tagged
  with the Buzz room's hex id, signs it with the bridge key, and publishes it
  to your relay.
- **Buzz ➔ Slack** — the bridge holds one relay subscription covering all
  mapped Buzz rooms. Incoming events are routed back to the owning Slack
  workspace/channel via `chat.postMessage`, prefixed `*[Buzz Client]*:`.
- **Echo-loop prevention** — bridged Slack messages are signed by the bridge's
  own Nostr key (skipped on the way back by pubkey), carry a rigid
  `[Slack - <user>]:` prefix (skipped as a second guard), and Slack-side bot
  messages (`bot_id` / `bot_message` subtype) are never re-bridged.
- **Multi-tenant** — any number of client workspaces install via OAuth. Tokens
  are stored per `team_id`, and each Slack channel remembers which workspace
  owns it so outbound traffic always uses the right bot token.

## Setup

### 1. Create the Slack app

At [api.slack.com/apps](https://api.slack.com/apps) create an app, then:

- **OAuth & Permissions** → Bot token scopes: `chat:write`,
  `channels:history`, `channels:read`, `groups:history`, `users:read`
- **OAuth & Permissions** → Redirect URL:
  `https://your-production-domain.com/slack/oauth_redirect`
- **Event Subscriptions** → Request URL:
  `https://your-production-domain.com/slack/events`, and subscribe to bot
  events: `message.channels`, `message.groups`, `member_joined_channel`
- Enable **public distribution** so external workspaces can install it.

### 2. Configure and run the bridge

```bash
cp .env.example .env   # fill in the Slack app credentials + a Nostr private key
npm install
npm start
```

Generate a bridge signing key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Privacy note:** everything published to a public relay (e.g.
> `relay.damus.io`) is world-readable. For client conversations, point
> `NOSTR_RELAY_URL` at a relay you control.

### 3. Onboard a workspace

Send the client (or yourself) to `https://your-domain.com/login` and click
**Add to Slack**. The OAuth flow stores the workspace's bot token in
`database.json` automatically.

### 4. Map a channel to a Buzz room

Invite the bot to the Slack channel. The server logs the channel id and the
exact JSON pair to add. Edit `database.json` (see `database.example.json` for
the schema) and add both directions under `channel_mappings`:

```json
"C0123456789": "buzz_room_hex_id…",
"buzz_room_hex_id…": "C0123456789"
```

The bridge watches `database.json` and re-synchronizes its relay
subscriptions automatically — no restart needed.

## Free-tier playbook

- Works with **free Slack workspaces** — the Events API and OAuth used here
  are available on every plan.
- To join a *client's paid* workspace without Slack Connect, use their
  **single-channel guest** seats (5 free guests per paid member) or an
  Enterprise Grid free-join flag, and run the bridge bot inside the shared
  channel.
- The Nostr relay side is free by design; any open relay or a self-hosted
  [strfry](https://github.com/hoytech/strfry)/`nostr-rs-relay` instance works.

## Files

| File | Purpose |
|------|---------|
| `server.js` | The whole bridge: OAuth receiver, both pipelines, channel hooks |
| `database.json` | Flat-file store: workspace tokens, channel maps, user directory (git-ignored — holds secrets) |
| `database.example.json` | Schema reference with mock values |
| `.env.example` | Environment template — copy to `.env` |
