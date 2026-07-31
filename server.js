import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pkg from '@slack/bolt';
import { getPublicKey } from 'nostr-tools/pure';
import { loadMasterKey, encryptSecret, decryptSecret, deriveUserKey } from './src/crypto.js';
import { BridgeDB } from './src/db.js';
import { slackMessageToPlain } from './src/slack-format.js';
import { BuzzClient } from './src/nostr.js';

const { App, ExpressReceiver } = pkg;

// ---------------------------------------------------------------------------
// Configuration — fail fast on anything missing or malformed
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET',
  'PUBLIC_BASE_URL', 'BUZZ_RELAY_URL', 'BRIDGE_MASTER_KEY',
];
// Back-compat aliases from the v1 flat-file era.
process.env.PUBLIC_BASE_URL ||= process.env.REDIRECT_URI;
process.env.BUZZ_RELAY_URL ||= process.env.NOSTR_RELAY_URL;
process.env.BRIDGE_MASTER_KEY ||= process.env.BUZZ_BRIDGE_SECRET_KEY;

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

let masterKey;
try {
  masterKey = loadMasterKey(process.env.BRIDGE_MASTER_KEY);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
const KEY_MODE = process.env.BRIDGE_KEY_MODE === 'per-user' ? 'per-user' : 'single';
const DB_PATH = process.env.BRIDGE_DB || './data/bridge.sqlite';
const SCOPES = ['chat:write', 'channels:history', 'channels:read', 'groups:history', 'users:read'];

// The bridge's own Nostr identity is derived from the master key, so one
// secret drives token encryption, NIP-42 auth, and message signing.
const bridgeKey = deriveUserKey(masterKey, '__bridge__');
const bridgePubkey = getPublicKey(bridgeKey);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new BridgeDB(DB_PATH);

// ---------------------------------------------------------------------------
// One-time migration from the v1 database.json flat file
// ---------------------------------------------------------------------------
const LEGACY_DB = 'database.json';
if (fs.existsSync(LEGACY_DB)) {
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_DB, 'utf8'));
    for (const [teamId, ws] of Object.entries(legacy.workspaces || {})) {
      if (!db.getWorkspace(teamId)) {
        db.saveWorkspace(teamId, encryptSecret(masterKey, ws.bot_token, teamId), ws.bot_id ?? null, ws.bot_user_id ?? null);
      }
    }
    const teams = Object.keys(legacy.workspaces || {});
    for (const [k, v] of Object.entries(legacy.channel_mappings || {})) {
      if (k.startsWith('C') && !db.channelBySlack(k)) {
        db.mapChannel(k, v, legacy.channel_teams?.[k] || teams[0] || 'unknown');
      }
    }
    for (const [userId, name] of Object.entries(legacy.user_directory || {})) {
      db.saveUser({ slackUserId: userId, displayName: name });
    }
    fs.renameSync(LEGACY_DB, `${LEGACY_DB}.migrated`);
    console.log('✅ Migrated legacy database.json → SQLite (renamed to database.json.migrated).');
  } catch (e) {
    console.error('Legacy database.json migration failed (leaving file untouched):', e.message);
  }
}

// ---------------------------------------------------------------------------
// Multi-tenant Slack OAuth receiver (HTTP Events API transport)
// ---------------------------------------------------------------------------
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET || 'nostr-bridge-v1-auth-handshake',
  scopes: SCOPES,
  redirectUri: `${PUBLIC_BASE_URL}/slack/oauth_redirect`,
  installerOptions: { redirectUriPath: '/slack/oauth_redirect' },
  installationStore: {
    storeInstallation: async (installation) => {
      const teamId = installation.team?.id || installation.enterprise?.id;
      // Install allowlist: with public distribution on, anyone who finds the
      // install link could connect their workspace to this bridge. Unknown
      // teams are rejected before their token is ever stored.
      const allowed = (process.env.SLACK_ALLOWED_TEAMS || '')
        .split(',').map((t) => t.trim()).filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(teamId)) {
        console.warn(`⛔ Rejected install from non-allowlisted workspace ${teamId} (${installation.team?.name || 'unknown name'})`);
        throw new Error(`Workspace ${teamId} is not authorized to install this bridge.`);
      }
      db.saveWorkspace(
        teamId,
        encryptSecret(masterKey, installation.bot.token, teamId),
        installation.bot.id,
        installation.bot.userId
      );
      console.log(`✅ Workspace installed: ${teamId} (${installation.team?.name || 'unknown name'})${allowed.length === 0 ? ' — note: no SLACK_ALLOWED_TEAMS allowlist is set' : ''}`);
    },
    fetchInstallation: async (installQuery) => {
      const ws = db.getWorkspace(installQuery.teamId);
      if (!ws) throw new Error('No installation found for this workspace.');
      return {
        team: { id: installQuery.teamId },
        enterprise: undefined,
        bot: {
          token: decryptSecret(masterKey, ws.bot_token_enc, installQuery.teamId),
          id: ws.bot_id,
          userId: ws.bot_user_id,
          scopes: SCOPES,
        },
      };
    },
    deleteInstallation: async (installQuery) => db.deleteWorkspace(installQuery.teamId),
  },
});

// SLACK_API_URL is a test hook: integration tests point it at a mock Slack
// API server. Unset in production, so the SDK uses slack.com.
const slackApp = new App({
  receiver,
  ...(process.env.SLACK_API_URL ? { clientOptions: { slackApiUrl: process.env.SLACK_API_URL } } : {}),
});

function botTokenForTeam(teamId) {
  const ws = teamId ? db.getWorkspace(teamId) : db.firstWorkspace();
  if (!ws) return undefined;
  return decryptSecret(masterKey, ws.bot_token_enc, ws.team_id);
}

// ---------------------------------------------------------------------------
// OAuth landing page + health endpoint
// ---------------------------------------------------------------------------
receiver.app.get('/login', (req, res) => {
  res.send(`
    <html>
      <head><title>Connect Slack to Buzz</title></head>
      <body style="font-family:sans-serif; text-align:center; padding-top:100px; background:#f4f7f6;">
        <div style="background:white; padding:40px; display:inline-block; border-radius:8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2>Connect your Slack workspace to Buzz</h2>
          <p style="color:#666; margin-bottom:30px;">Grant permissions to bridge shared channels into your Buzz hive.</p>
          <a href="/slack/install">
            <img alt="Add to Slack" height="40" width="139"
              src="https://platform.slack-edge.com/img/add_to_slack.png"
              srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" />
          </a>
        </div>
      </body>
    </html>
  `);
});

receiver.app.get('/healthz', (req, res) =>
  res.json({ ok: true, relay: buzz.relay?.connected ?? false, channels: db.allChannels().length })
);

// ---------------------------------------------------------------------------
// Outbound pipeline (Buzz ➔ Slack), invoked per subscribed relay event
// ---------------------------------------------------------------------------
async function handleBuzzEvent(event) {
  // Echo-loop prevention, rigidly enforced in this order:
  // 1. anything signed by the bridge's own identity
  if (event.pubkey === bridgePubkey) return;
  // 2. anything signed by a bridge-derived per-user key
  if (db.userByPubkey(event.pubkey)) return;
  // 3. the legacy content-prefix contract
  if (event.content.startsWith('[Slack -')) return;

  const hTag = event.tags.find((t) => t[0] === 'h');
  if (!hTag) return;
  const mapping = db.channelByBuzz(hTag[1]);
  if (!mapping) return;

  const token = botTokenForTeam(mapping.team_id);
  if (!token) {
    console.error(`No bot token for team ${mapping.team_id} — cannot deliver Buzz event ${event.id}`);
    return;
  }

  // Thread routing: a NIP-10 marked reply whose parent we bridged maps onto
  // the parent's Slack thread. Unknown parents fall back to top-level.
  let threadTs;
  const replyTag = event.tags.find((t) => t[0] === 'e' && (t[3] === 'reply' || t[3] === 'root'));
  if (replyTag) {
    threadTs = db.slackRefForEventId(replyTag[1])?.slack_ts;
  }

  // Attribution: kind:0 profile name, cached in SQLite.
  let author = db.profileName(event.pubkey);
  if (!author) {
    author = (await buzz.fetchProfileName(event.pubkey)) || `npub…${event.pubkey.slice(0, 8)}`;
    db.saveProfile(event.pubkey, author);
  }

  try {
    const res = await slackApp.client.chat.postMessage({
      token,
      channel: mapping.slack_channel_id,
      text: `*[Buzz] ${author}*: ${event.content}`,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    // Record the posted message so Slack thread replies to it route back
    // into this Buzz thread.
    db.recordMessage(mapping.slack_channel_id, res.ts, event.id, 'b2s');
  } catch (err) {
    console.error('Buzz→Slack delivery faulted:', err.data?.error || err.message);
  }
}

const buzz = new BuzzClient({ url: process.env.BUZZ_RELAY_URL, authKey: bridgeKey, onEvent: handleBuzzEvent });

// ---------------------------------------------------------------------------
// Inbound pipeline (Slack ➔ Buzz)
// ---------------------------------------------------------------------------
slackApp.message(async ({ message, client, context }) => {
  if (message.bot_id || message.subtype === 'bot_message') return;
  if (message.subtype && message.subtype !== 'thread_broadcast' && message.subtype !== 'file_share') return;

  const mapping = db.channelBySlack(message.channel);
  if (!mapping) return;
  if (!message.user) return; // system/subtype messages carry no author

  // Resolve author (cached in SQLite; profile fetched once per user).
  let user = db.getUser(message.user);
  if (!user?.display_name) {
    let displayName = message.user;
    try {
      const profile = await client.users.info({ user: message.user });
      displayName = profile.user.real_name || profile.user.name;
    } catch (e) {
      console.error('users.info failed:', e.data?.error || e.message);
    }
    const pubkey = KEY_MODE === 'per-user'
      ? getPublicKey(deriveUserKey(masterKey, message.user))
      : null;
    db.saveUser({ slackUserId: message.user, teamId: context.teamId, displayName, pubkey });
    user = db.getUser(message.user);
  }

  const text = slackMessageToPlain(message, (id) => db.getUser(id)?.display_name);
  if (!text) return;

  // Slack threads are flat: thread_ts is always the root message's ts.
  let parentEventId;
  if (message.thread_ts && message.thread_ts !== message.ts) {
    parentEventId = db.eventIdForSlackTs(message.channel, message.thread_ts);
    if (!parentEventId) {
      console.warn(`Thread parent ${message.thread_ts} was never bridged — posting top-level.`);
    }
  }

  const signerKey = KEY_MODE === 'per-user' ? deriveUserKey(masterKey, message.user) : undefined;
  const content = KEY_MODE === 'per-user' ? text : `[Slack - ${user.display_name}]: ${text}`;

  try {
    const event = await buzz.publishChatMessage({
      buzzChannelId: mapping.buzz_channel_id,
      content,
      parentEventId,
      signerKey,
    });
    db.recordMessage(message.channel, message.ts, event.id, 's2b');
  } catch (e) {
    console.error('Slack→Buzz publish faulted:', e.message);
  }
});

// ---------------------------------------------------------------------------
// Channel onboarding: bot invited to a Slack channel
// ---------------------------------------------------------------------------
slackApp.event('member_joined_channel', async ({ event }) => {
  const ws = db.getWorkspace(event.team);
  if (event.user !== ws?.bot_user_id) return;
  if (db.channelBySlack(event.channel)) return;

  console.log(`\n🚨 New channel awaiting mapping: ${event.channel} (team ${event.team})`);
  console.log(`Map it with: npm run map -- ${event.channel} <buzz-channel-uuid> ${event.team}\n`);
});

// ---------------------------------------------------------------------------
// Subscription lifecycle: follow the channel-mapping set as it changes
// ---------------------------------------------------------------------------
let lastChannelSet = '';
function syncSubscriptions() {
  const buzzIds = db.allChannels().map((c) => c.buzz_channel_id).sort();
  const key = buzzIds.join(',');
  if (key === lastChannelSet && buzz.sub) return;
  lastChannelSet = key;
  buzz.subscribe(buzzIds);
}

// ---------------------------------------------------------------------------
// Startup / shutdown
// ---------------------------------------------------------------------------
await buzz.connect();
syncSubscriptions();
const subscriptionPoll = setInterval(syncSubscriptions, 15000);

await slackApp.start(process.env.PORT || 3000);
console.log(`🚀 Bridge online on port ${process.env.PORT || 3000} (key mode: ${KEY_MODE}).`);
console.log(`   OAuth landing page: ${PUBLIC_BASE_URL}/login`);
console.log(`   Bridge Nostr pubkey: ${bridgePubkey}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`\n${sig} received — shutting down.`);
    clearInterval(subscriptionPoll);
    try {
      buzz.close();
      await slackApp.stop();
      db.close();
    } finally {
      process.exit(0);
    }
  });
}
