# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities. Instead,
use GitHub's private vulnerability reporting on this repository ("Security"
tab → "Report a vulnerability"), or email the maintainer directly.

You can expect an acknowledgment within a few days. Please include
reproduction steps and an assessment of impact.

## Scope and known security properties

Deployers should understand these properties of the bridge:

- **Slack bot tokens** (`xoxb-`) for every installed workspace are stored in
  SQLite **encrypted with AES-256-GCM**, each ciphertext bound to its
  workspace id. The encryption defends leaked database files and backups —
  it does **not** defend a fully compromised host, where `BRIDGE_MASTER_KEY`
  is also readable. Protect `.env` (mode 600) and never commit it.
- **Relay privacy is the deployer's responsibility.** Any message bridged to
  a public Nostr relay is world-readable, permanently. Point
  `NOSTR_RELAY_URL` at a relay you control, and note that a write-whitelisted
  relay is not necessarily read-restricted.
- **Bridged client text is untrusted input.** Anything typed in a connected
  Slack channel flows to the Nostr side verbatim (after formatting
  normalization). Systems consuming the relay stream — especially AI agents —
  must treat bridge-originated content as unprivileged data, keyed off the
  bridge's signing pubkey, never as instructions.
- **OAuth state** is CSRF-protected by Bolt; set your own `SLACK_STATE_SECRET`
  in production rather than relying on the default.
- **Public distribution is workspace-scoped.** An installer only ever
  connects their own workspace; no install can grant access to another
  workspace's data. Unsolicited installs (strangers connecting their
  workspace to your server) are mitigated by the `SLACK_ALLOWED_TEAMS`
  allowlist — set it once you know your clients' team IDs — and by the
  fact that unmapped channels never bridge anywhere.
