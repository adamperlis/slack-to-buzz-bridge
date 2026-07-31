import 'dotenv/config';
import fs from 'fs';
import pkg from '@slack/bolt';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';

const { App, ExpressReceiver } = pkg;

// nostr-tools has no native WebSocket in Node — wire in the `ws` implementation.
useWebSocketImplementation(WebSocket);

// ---------------------------------------------------------------------------
// Startup validation — fail fast on missing/invalid configuration
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'REDIRECT_URI',
  'NOSTR_RELAY_URL',
  'BUZZ_BRIDGE_SECRET_KEY',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (!/^[0-9a-f]{64}$/i.test(process.env.BUZZ_BRIDGE_SECRET_KEY)) {
  console.error('BUZZ_BRIDGE_SECRET_KEY must be a 32-byte hex string (64 hex characters).');
  process.exit(1);
}

const PUBLIC_BASE_URL = process.env.REDIRECT_URI.replace(/\/+$/, '');
const bridgePrivKey = Uint8Array.from(Buffer.from(process.env.BUZZ_BRIDGE_SECRET_KEY, 'hex'));
let bridgePubKey;
try {
  bridgePubKey = getPublicKey(bridgePrivKey);
} catch {
  console.error('BUZZ_BRIDGE_SECRET_KEY is not a valid secp256k1 private key.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helper database operations (flat-file JSON, multi-tenant relational dicts)
// ---------------------------------------------------------------------------
const DB_FILE = 'database.json';
const EMPTY_DB = { workspaces: {}, channel_mappings: {}, channel_teams: {}, user_directory: {} };

function readDB() {
  if (!fs.existsSync(DB_FILE)) return structuredClone(EMPTY_DB);
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return { ...structuredClone(EMPTY_DB), ...db };
  } catch (e) {
    console.error(`Failed to parse ${DB_FILE}, refusing to clobber it:`, e.message);
    throw e;
  }
}

function writeDB(db) {
  // Write-then-rename keeps the file intact if the process dies mid-write.
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function saveWorkspace(teamId, botToken, botId, botUserId) {
  const db = readDB();
  db.workspaces[teamId] = { bot_token: botToken, bot_id: botId, bot_user_id: botUserId };
  writeDB(db);
}

function getBotTokenByTeam(teamId) {
  return readDB().workspaces[teamId]?.bot_token;
}

function rememberChannelTeam(channelId, teamId) {
  if (!teamId) return;
  const db = readDB();
  if (db.channel_teams[channelId] === teamId) return;
  db.channel_teams[channelId] = teamId;
  writeDB(db);
}

const isBuzzHexId = (id) => /^[0-9a-f]{64}$/i.test(id);

// ---------------------------------------------------------------------------
// Emoji + Slack mrkdwn normalization (Slack ➔ Buzz plain text)
// ---------------------------------------------------------------------------
const EMOJI_MAP = {
  smile: '😄', smiley: '😃', grin: '😁', joy: '😂', laughing: '😆',
  slightly_smiling_face: '🙂', wink: '😉', blush: '😊', sunglasses: '😎',
  thinking_face: '🤔', neutral_face: '😐', cry: '😢', sob: '😭', angry: '😠',
  scream: '😱', heart: '❤️', broken_heart: '💔', '+1': '👍', thumbsup: '👍',
  '-1': '👎', thumbsdown: '👎', ok_hand: '👌', wave: '👋', clap: '👏',
  raised_hands: '🙌', pray: '🙏', muscle: '💪', point_up: '☝️',
  point_right: '👉', point_left: '👈', point_down: '👇', eyes: '👀',
  fire: '🔥', tada: '🎉', rocket: '🚀', sparkles: '✨', star: '⭐',
  '100': '💯', white_check_mark: '✅', heavy_check_mark: '✔️', x: '❌',
  warning: '⚠️', question: '❓', exclamation: '❗', bulb: '💡', memo: '📝',
  calendar: '📅', bell: '🔔', lock: '🔒', key: '🔑', link: '🔗', mag: '🔍',
  chart_with_upwards_trend: '📈', chart_with_downwards_trend: '📉',
  moneybag: '💰', dollar: '💵', gift: '🎁', bug: '🐛', wrench: '🔧',
  hammer: '🔨', gear: '⚙️', package: '📦', books: '📚', phone: '📞',
  envelope: '✉️', email: '📧', computer: '💻', coffee: '☕', beer: '🍺',
  pizza: '🍕', zzz: '💤', shrug: '🤷', facepalm: '🤦', skull: '💀',
  handshake: '🤝', speech_balloon: '💬', hourglass: '⌛', check: '✅',
};

function transformEmojis(text) {
  // Known shortcodes become unicode; unknown/custom ones are stripped so
  // Buzz never renders raw :something_custom: noise.
  return text.replace(/:([a-z0-9_+\-]+):/gi, (match, code) => {
    const key = code.toLowerCase();
    if (EMOJI_MAP[key]) return EMOJI_MAP[key];
    // Skin-tone modifiers ride along with a base emoji — drop them silently.
    if (/^skin-tone-\d$/.test(key)) return '';
    return '';
  });
}

function slackTextToPlain(text, db) {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (m, id) => `@${db.user_directory[id] || id}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(channel|here|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// 1. Multi-tenant Slack OAuth Express receiver
// ---------------------------------------------------------------------------
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET || 'nostr-bridge-v1-auth-handshake',
  scopes: ['chat:write', 'channels:history', 'channels:read', 'groups:history', 'users:read'],
  redirectUri: `${PUBLIC_BASE_URL}/slack/oauth_redirect`,
  installerOptions: {
    redirectUriPath: '/slack/oauth_redirect',
  },
  installationStore: {
    storeInstallation: async (installation) => {
      const teamId = installation.team?.id || installation.enterprise?.id;
      saveWorkspace(teamId, installation.bot.token, installation.bot.id, installation.bot.userId);
      console.log(`✅ Workspace installed: ${teamId}`);
    },
    fetchInstallation: async (installQuery) => {
      const db = readDB();
      const workspace = db.workspaces[installQuery.teamId];
      if (!workspace) throw new Error('No install sequence matches this profile.');
      return {
        team: { id: installQuery.teamId },
        enterprise: undefined,
        bot: {
          token: workspace.bot_token,
          id: workspace.bot_id,
          userId: workspace.bot_user_id,
          scopes: ['chat:write', 'channels:history', 'channels:read', 'groups:history', 'users:read'],
        },
      };
    },
    deleteInstallation: async (installQuery) => {
      const db = readDB();
      delete db.workspaces[installQuery.teamId];
      writeDB(db);
    },
  },
});

const slackApp = new App({ receiver });

// ---------------------------------------------------------------------------
// 2. OAuth frontend — "Add to Slack" landing page
//    Links to Bolt's own /slack/install so the state param is handled for us.
// ---------------------------------------------------------------------------
receiver.app.get('/login', (req, res) => {
  res.send(`
    <html>
      <head><title>Connect Slack to Buzz</title></head>
      <body style="font-family:sans-serif; text-align:center; padding-top:100px; background:#f4f7f6;">
        <div style="background:white; padding:40px; display:inline-block; border-radius:8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2>Connect Slack Connect to your Buzz Workspace</h2>
          <p style="color:#666; margin-bottom:30px;">Grant permissions to automate seamless, zero-cost cross-channel pipelines.</p>
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

receiver.app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Nostr relay connection (with reconnect + resubscribe)
// ---------------------------------------------------------------------------
let relay = null;

async function connectRelay() {
  let attempt = 0;
  for (;;) {
    try {
      relay = await Relay.connect(process.env.NOSTR_RELAY_URL);
      console.log(`🔌 Connected to Nostr relay ${process.env.NOSTR_RELAY_URL}`);
      relay.onclose = () => {
        console.warn('Relay connection closed — reconnecting…');
        setTimeout(async () => {
          await connectRelay();
          synchronizeBuzzTracks();
        }, 2000);
      };
      return;
    } catch (e) {
      const delay = Math.min(30000, 2000 * 2 ** attempt++);
      console.error(`Relay connect failed (${e.message}), retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Inbound pipeline (Slack ➔ Buzz)
// ---------------------------------------------------------------------------
slackApp.message(async ({ message, client, context }) => {
  // Infinite echo loop prevention — never rebroadcast bot traffic.
  if (message.bot_id || message.subtype === 'bot_message') return;
  if (!message.text) return; // file-only / join messages carry no text

  const db = readDB();
  const targetBuzzHexRoom = db.channel_mappings[message.channel];
  if (!targetBuzzHexRoom) return; // discard traffic if unmapped

  // Record which workspace owns this channel so outbound replies can route back.
  rememberChannelTeam(message.channel, context.teamId || message.team);

  // Resolve a human-readable username so attribution survives inside Buzz.
  let username = message.user;
  if (db.user_directory[message.user]) {
    username = db.user_directory[message.user];
  } else {
    try {
      const userProfile = await client.users.info({ user: message.user });
      username = userProfile.user.real_name || userProfile.user.name;
      const fresh = readDB();
      fresh.user_directory[message.user] = username;
      writeDB(fresh);
    } catch (e) {
      console.error('Failed to profile user:', e.message);
    }
  }

  const cleanText = transformEmojis(slackTextToPlain(message.text, readDB()));

  // Wrap text into a standard Nostr kind-1 cryptographic event frame.
  const eventTemplate = {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', targetBuzzHexRoom, '', 'root']],
    content: `[Slack - ${username}]: ${cleanText}`,
  };

  try {
    const signedEvent = finalizeEvent(eventTemplate, bridgePrivKey);
    await relay.publish(signedEvent);
  } catch (e) {
    console.error('Nostr publish faulted:', e.message);
  }
});

// ---------------------------------------------------------------------------
// 4. Outbound pipeline (Buzz ➔ Slack)
// ---------------------------------------------------------------------------
let activeNostrSub = null;
let subscribedMappingsSnapshot = '';

function synchronizeBuzzTracks() {
  if (activeNostrSub) {
    activeNostrSub.close();
    activeNostrSub = null;
  }
  if (!relay || !relay.connected) return;

  const db = readDB();
  subscribedMappingsSnapshot = JSON.stringify(db.channel_mappings);
  const activeBuzzHexTargets = Object.keys(db.channel_mappings).filter(isBuzzHexId);
  if (activeBuzzHexTargets.length === 0) {
    console.log('No Buzz rooms mapped yet — outbound sync idle.');
    return;
  }

  activeNostrSub = relay.subscribe(
    [
      {
        kinds: [1],
        '#e': activeBuzzHexTargets,
        since: Math.floor(Date.now() / 1000),
      },
    ],
    {
      onevent: async (event) => {
        // Escape loop echo traces: skip anything the bridge itself signed,
        // plus the rigid [Slack - prefix contract.
        if (event.pubkey === bridgePubKey) return;
        if (event.content.startsWith('[Slack -')) return;

        const targetRootTag = event.tags.find((t) => t[0] === 'e');
        if (!targetRootTag) return;

        const dbInstance = readDB();
        const targetSlackChannelId = dbInstance.channel_mappings[targetRootTag[1]];
        if (!targetSlackChannelId) return;

        // Route back out using the workspace that owns this Slack channel,
        // falling back to the first installed workspace for single-tenant setups.
        const teamId =
          dbInstance.channel_teams[targetSlackChannelId] ||
          Object.keys(dbInstance.workspaces)[0];
        const activeToken = dbInstance.workspaces[teamId]?.bot_token;
        if (!activeToken) return;

        await slackApp.client.chat
          .postMessage({
            token: activeToken,
            channel: targetSlackChannelId,
            text: `*[Buzz Client]*: ${event.content}`,
          })
          .catch((err) => console.error('Outbound push execution faulted:', err.message));
      },
    }
  );

  console.log(`📡 Subscribed to ${activeBuzzHexTargets.length} Buzz room(s).`);
}

// Re-sync subscriptions when database.json is edited (new mappings added by
// hand). The server also writes this file itself (username cache, channel
// teams), so only resubscribe when channel_mappings actually changed —
// tearing down the relay subscription drops the event stream for a moment.
let resyncTimer = null;
fs.watchFile(DB_FILE, { interval: 2000 }, () => {
  clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => {
    let mappings;
    try {
      mappings = JSON.stringify(readDB().channel_mappings);
    } catch {
      return; // half-written or invalid JSON — next change event will retry
    }
    if (mappings === subscribedMappingsSnapshot) return;
    console.log('channel_mappings changed — resynchronizing Buzz subscriptions.');
    synchronizeBuzzTracks();
  }, 500);
});

// ---------------------------------------------------------------------------
// 5. Dynamic setup hook — bot invited to a new Slack channel
// ---------------------------------------------------------------------------
slackApp.event('member_joined_channel', async ({ event }) => {
  const db = readDB();
  const botUserId = db.workspaces[event.team]?.bot_user_id;
  if (event.user !== botUserId) return;

  rememberChannelTeam(event.channel, event.team);

  console.log(`\n🚨 DYNAMIC EXTENSION REQUEST REGISTERED FOR CHANNEL: ${event.channel}`);
  console.log('Add this config pair to database.json under channel_mappings to establish routing:');
  console.log(`"${event.channel}": "TARGET_BUZZ_CHANNEL_HEX_ID"`);
  console.log(`"TARGET_BUZZ_CHANNEL_HEX_ID": "${event.channel}"\n`);
});

// ---------------------------------------------------------------------------
// Initialize systems
// ---------------------------------------------------------------------------
await connectRelay();
synchronizeBuzzTracks();
await slackApp.start(process.env.PORT || 3000);
console.log(`🚀 Integration server online on port ${process.env.PORT || 3000}.`);
console.log(`   OAuth landing page: ${PUBLIC_BASE_URL}/login`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`\n${sig} received — shutting down.`);
    try {
      if (activeNostrSub) activeNostrSub.close();
      if (relay) {
        relay.onclose = null;
        relay.close();
      }
      await slackApp.stop();
    } finally {
      process.exit(0);
    }
  });
}
