# Contributing

Thanks for your interest in improving slack-to-buzz-bridge!

## Development setup

```bash
git clone https://github.com/adamperlis/slack-to-buzz-bridge.git
cd slack-to-buzz-bridge
npm install
cp .env.example .env   # fill in your own Slack app + Nostr key values
npm start
```

Node.js 18+ is required (the project uses native ESM, `fetch`, and
`structuredClone`).

## Testing your changes

There is no external-service dependency for basic validation — the server can
be exercised against a mock local Nostr relay (a small `ws` server that
answers `REQ` with `EOSE` and accepts `EVENT`) and fake Slack credentials.
At minimum, before opening a PR:

1. `node --check server.js` passes.
2. The server boots against a local relay, serves `/login`, `/slack/install`,
   and `/healthz`, and opens a relay subscription when `database.json`
   contains at least one channel mapping.

## Guidelines

- Keep the echo-loop prevention rules intact: never rebroadcast events signed
  by the bridge's own pubkey, messages prefixed `[Slack -`, or Slack messages
  carrying `bot_id`/`bot_message`. Extensions must preserve all three guards.
- Secrets never enter git: `.env` and `database.json` are git-ignored — keep
  it that way. Mock values in examples must be obviously fake.
- Match the existing code style (single-file server, plain ESM, no
  TypeScript build step).
- One logical change per PR, with a clear description of the behavior change
  and how you verified it.

## Reporting bugs

Open a GitHub issue with reproduction steps, expected vs. actual behavior,
and your Node.js version. For anything security-sensitive, see
[SECURITY.md](SECURITY.md) instead of filing a public issue.
