// Regression test for the per-user-mode echo loop: a user row created
// before BRIDGE_KEY_MODE=per-user was enabled has no stored pubkey; the
// bridge must backfill it so its own events are recognized and never
// relayed back into Slack.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { verifyEvent, finalizeEvent, getPublicKey } from 'nostr-tools/pure';

import { loadMasterKey, encryptSecret, deriveUserKey } from '../src/crypto.js';
import { BridgeDB } from '../src/db.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RELAY_PORT = 7794;
const SLACK_PORT = 7795;
const BRIDGE_PORT = 7796;
const MASTER_KEY_HEX = crypto.randomBytes(32).toString('hex');
const SIGNING_SECRET = 'test-signing-secret';
const BUZZ_CHANNEL = 'b2c3d4e5-0000-0000-0000-000000000002';

const relayState = { events: [], authed: new Set(), subs: [] };

function broadcast(event) {
  for (const { ws, subId, filters } of relayState.subs) {
    const match = filters.some(
      (f) =>
        (!f.kinds || f.kinds.includes(event.kind)) &&
        (!f['#h'] || event.tags.some((t) => t[0] === 'h' && f['#h'].includes(t[1])))
    );
    if (match && ws.readyState === ws.OPEN) ws.send(JSON.stringify(['EVENT', subId, event]));
  }
}

const relayServer = new WebSocketServer({ port: RELAY_PORT });
relayServer.on('connection', (ws) => {
  const challenge = crypto.randomBytes(16).toString('hex');
  ws.send(JSON.stringify(['AUTH', challenge]));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg[0] === 'AUTH') {
      const ok = msg[1].kind === 22242 && verifyEvent(msg[1]);
      if (ok) relayState.authed.add(ws);
      ws.send(JSON.stringify(['OK', msg[1].id, ok, '']));
    } else if (msg[0] === 'EVENT') {
      relayState.events.push(msg[1]);
      broadcast(msg[1]);
      ws.send(JSON.stringify(['OK', msg[1].id, true, '']));
    } else if (msg[0] === 'REQ') {
      relayState.subs.push({ ws, subId: msg[1], filters: msg.slice(2) });
      ws.send(JSON.stringify(['EOSE', msg[1]]));
    }
  });
});

const slackCalls = { postMessage: [] };
const slackServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('users.info')) {
      res.end(JSON.stringify({ ok: true, user: { real_name: 'Legacy User', name: 'legacy' } }));
    } else if (req.url.includes('chat.postMessage')) {
      slackCalls.postMessage.push(Object.fromEntries(new URLSearchParams(body).entries()));
      res.end(JSON.stringify({ ok: true, ts: `3000.${slackCalls.postMessage.length}` }));
    } else {
      res.end(JSON.stringify({ ok: true }));
    }
  });
});

let bridge;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-peruser-'));
const dbPath = path.join(dataDir, 'bridge.sqlite');

function sendSlackEvent(event) {
  const body = JSON.stringify({
    type: 'event_callback', team_id: 'T_TEST',
    event_id: `Ev${crypto.randomBytes(4).toString('hex')}`,
    event_time: Math.floor(Date.now() / 1000), event,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(`v0:${ts}:${body}`).digest('hex');
  return fetch(`http://127.0.0.1:${BRIDGE_PORT}/slack/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': sig },
    body,
  });
}

const waitFor = async (fn, ms = 20000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('waitFor timed out');
};

before(async () => {
  const masterKey = loadMasterKey(MASTER_KEY_HEX);
  const seed = new BridgeDB(dbPath);
  seed.saveWorkspace('T_TEST', encryptSecret(masterKey, 'xoxb-test-token', 'T_TEST'), 'B_TEST', 'U_BOT');
  seed.mapChannel('C_TEST', BUZZ_CHANNEL, 'T_TEST');
  // The critical fixture: a user row from before per-user mode — no pubkey.
  seed.saveUser({ slackUserId: 'U_LEGACY', teamId: 'T_TEST', displayName: 'Legacy User', pubkey: null });
  seed.close();

  slackServer.listen(SLACK_PORT);
  bridge = spawn('node', ['server.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(BRIDGE_PORT), SLACK_CLIENT_ID: '1.2', SLACK_CLIENT_SECRET: 'x',
      SLACK_SIGNING_SECRET: SIGNING_SECRET, PUBLIC_BASE_URL: 'https://example.com',
      BUZZ_RELAY_URL: `ws://127.0.0.1:${RELAY_PORT}`, BRIDGE_MASTER_KEY: MASTER_KEY_HEX,
      BRIDGE_DB: dbPath, SLACK_API_URL: `http://127.0.0.1:${SLACK_PORT}/api/`,
      BRIDGE_KEY_MODE: 'per-user',
    },
  });
  bridge.stderr.on('data', (d) => process.stderr.write(`[bridge!] ${d}`));
  await waitFor(() => relayState.subs.length > 0, 30000);
});

after(async () => {
  bridge?.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 500));
  relayServer.close();
  slackServer.close();
});

test('per-user mode signs with the derived key and no prefix', async () => {
  await sendSlackEvent({ type: 'message', channel: 'C_TEST', user: 'U_LEGACY', text: 'hello from legacy', ts: '1000.100' });
  const evt = await waitFor(() => relayState.events.find((e) => e.kind === 9));
  const masterKey = loadMasterKey(MASTER_KEY_HEX);
  assert.equal(evt.pubkey, getPublicKey(deriveUserKey(masterKey, 'U_LEGACY')));
  assert.equal(evt.content, 'hello from legacy');
  assert.ok(!evt.content.startsWith('[Slack -'));
});

test('backfilled pubkey prevents the echo loop for pre-mode-switch users', async () => {
  const own = relayState.events.find((e) => e.kind === 9);
  const countBefore = slackCalls.postMessage.length;
  broadcast(own); // relay echoes the bridge's own event back, as real relays do
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(slackCalls.postMessage.length, countBefore, 'own event must not be relayed back to Slack');
});

test('genuine Buzz events still flow to Slack (guard is not over-broad)', async () => {
  const foreign = finalizeEvent({
    kind: 9, created_at: Math.floor(Date.now() / 1000) + 1,
    tags: [['h', BUZZ_CHANNEL]], content: 'real buzz reply',
  }, Uint8Array.from(crypto.randomBytes(32)));
  relayState.events.push(foreign);
  broadcast(foreign);
  const call = await waitFor(() => slackCalls.postMessage.find((c) => c.text?.includes('real buzz reply')));
  assert.equal(call.channel, 'C_TEST');
});
