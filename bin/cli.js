#!/usr/bin/env node
// slack-to-buzz-bridge CLI — usable via npx from any directory:
//   npx slack-to-buzz-bridge init     scaffold .env with a generated master key
//   npx slack-to-buzz-bridge          start the bridge (default command)
//   npx slack-to-buzz-bridge map …    map a Slack channel to a Buzz channel
//   npx slack-to-buzz-bridge keygen   print a fresh 32-byte master key
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const [cmd = 'start', ...rest] = process.argv.slice(2);

// The .env template is embedded (not read from the package) because npm
// excludes .env* files from published tarballs.
const ENV_TEMPLATE = (masterKey) => `# slack-to-buzz-bridge configuration — never commit this file.
PORT=3000

# From https://api.slack.com/apps -> Your App -> Basic Information
SLACK_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
SLACK_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
SLACK_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET

# Optional: your own OAuth state secret (CSRF protection).
SLACK_STATE_SECRET=

# Public HTTPS base URL of this server (no trailing slash).
# Slack redirect URL:      <PUBLIC_BASE_URL>/slack/oauth_redirect
# Slack Events request URL: <PUBLIC_BASE_URL>/slack/events
PUBLIC_BASE_URL=https://your-production-domain.com

# WebSocket URL of your Buzz relay (NIP-29 managed relay, NIP-42 auth).
BUZZ_RELAY_URL=wss://buzz.your-domain.com

# Generated for you — treat like a password. Drives token encryption,
# the bridge's Nostr identity, and per-user key derivation.
BRIDGE_MASTER_KEY=${masterKey}

# 'single' (default) or 'per-user' (derived Nostr identity per Slack user).
BRIDGE_KEY_MODE=single

# SQLite database location (created on first run).
BRIDGE_DB=./data/bridge.sqlite
`;

switch (cmd) {
  case 'init': {
    if (fs.existsSync('.env')) {
      console.error('.env already exists here — refusing to overwrite it.');
      console.error('Delete or rename it first if you really want a fresh one.');
      process.exit(1);
    }
    const masterKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync('.env', ENV_TEMPLATE(masterKey), { mode: 0o600 });
    console.log('✅ Created .env with a freshly generated BRIDGE_MASTER_KEY.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Edit .env — fill in your Slack app credentials, PUBLIC_BASE_URL,');
    console.log('     and BUZZ_RELAY_URL (see the README setup guide).');
    console.log('  2. Run: npx slack-to-buzz-bridge');
    break;
  }

  case 'keygen':
    console.log(crypto.randomBytes(32).toString('hex'));
    break;

  case 'map':
    // map-channel.js reads process.argv directly; hand it the subcommand args.
    process.argv = [process.argv[0], 'map-channel', ...rest];
    await import('./map-channel.js');
    break;

  case 'start': {
    if (!fs.existsSync('.env') && !process.env.BRIDGE_MASTER_KEY) {
      console.error('No .env found in this directory and no config in the environment.');
      console.error('Run: npx slack-to-buzz-bridge init');
      process.exit(1);
    }
    await import('../server.js');
    break;
  }

  case '--version':
  case '-v':
  case 'version':
    console.log(version);
    break;

  default:
    console.log(`slack-to-buzz-bridge v${version}

Usage:
  npx slack-to-buzz-bridge init                       scaffold .env (generates master key)
  npx slack-to-buzz-bridge [start]                    run the bridge
  npx slack-to-buzz-bridge map <slack-id> <buzz-uuid> [team-id]
  npx slack-to-buzz-bridge keygen                     print a fresh master key
  npx slack-to-buzz-bridge version

Docs: https://github.com/adamperlis/slack-to-buzz-bridge`);
    process.exit(cmd === 'help' || cmd === '--help' ? 0 : 1);
}
