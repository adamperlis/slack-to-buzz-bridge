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

`npm test` runs the whole suite with no external-service dependency: unit
tests for crypto/formatting/persistence plus an integration test that boots
the real server against a mock NIP-29 relay (AUTH challenge, h-tag
enforcement, unknown-parent rejection) and a mock Slack API. All tests must
pass before opening a PR; add coverage for any new pipeline behavior.

## Guidelines

- Keep the echo-loop prevention rules intact: never rebroadcast events
  signed by bridge-held keys (bridge identity or derived per-user keys),
  messages prefixed `[Slack -`, or Slack messages carrying
  `bot_id`/`bot_message`. Extensions must preserve all of these guards.
- Secrets never enter git: `.env` and `data/` are git-ignored — keep it
  that way. Mock values in examples and tests must be obviously fake.
- Match the existing code style (plain ESM modules under `src/`, no
  TypeScript build step, prepared statements for all SQL).
- One logical change per PR, with a clear description of the behavior change
  and how you verified it.

## Releasing to npm (maintainers)

The package publishes as `slack-to-buzz-bridge` with a `bin` entry, so
users can run it via `npx slack-to-buzz-bridge`. To cut a release:

```bash
npm version minor          # or patch/major — bumps package.json + tags
npm pack --dry-run         # sanity-check the file list (no .env, no data/)
npm publish                # requires npm login as the package owner
git push && git push --tags
```

## Reporting bugs

Open a GitHub issue with reproduction steps, expected vs. actual behavior,
and your Node.js version. For anything security-sensitive, see
[SECURITY.md](SECURITY.md) instead of filing a public issue.
