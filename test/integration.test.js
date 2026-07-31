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
import { verifyEvent, finalizeEvent } from 'nostr-tools/pure';

import { loadMasterKey, encryptSecret } from '../src/crypto.js';
import { BridgeDB } from '../src/db.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RELAY_PORT = 7791;
const SLACK_PORT = 7792;
const BRIDGE_PORT = 7793;
const MASTER_KEY_HEX = crypto.randomBytes(32).toString('hex');
const SIGNING_SECRET = 'test-signing-secret';
const BUZZ_CHANNEL = 'a1b2c3d4-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Mock NIP-29 relay: proactive AUTH challenge, kind:9 h-tag enforcement,
// unknown-parent rejection, #h-filtered fan-out.
// ---------------------------------------------------------------------------
const relayState = {
  events: [],            // accepted events, in order
  authedSockets: new Set(),
  subs: [],              // {ws, subId, filters}
};

function relayAccepts(event) {
  if (event.kind !== 9) return { ok: true };
  if (!event.tags.some((t) => t[0] === 'h')) {
    return { ok: false, reason: 'invalid: channel-scoped events must include an h tag' };
  }
  const reply = event.tags.find((t) => t[0] === 'e');
  if (reply && !relayState.events.some((e) => e.id === reply[1])) {
    return { ok: false, reason: 'invalid: reply references unknown parent' };
  }
  return { ok: true };
}

function broadcast(event) {
  for (const { ws, subId, filters } of relayState.subs) {
    const match = filters.some(
      (f) =>
        (!f.kinds || f.kinds.includes(event.kind)) &&
        (!f['#h'] || event.tags.some((t) => t[0] === 'h' && f['#h'].includes(t[1])))
    );
    if (match && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(['EVENT', subId, event]));
    }
  }
}

const relayServer = new WebSocketServer({ port: RELAY_PORT });
relayServer.on('connection', (ws) => {
  const challenge = crypto.randomBytes(16).toString('hex');
  ws.send(JSON.stringify(['AUTH', challenge]));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg[0] === 'AUTH') {
      const evt = msg[1];
      const okAuth =
        evt.kind === 22242 &&
        verifyEvent(evt) &&
        evt.tags.some((t) => t[0] === 'challenge' && t[1] === challenge);
      if (okAuth) relayState.authedSockets.add(ws);
      ws.send(JSON.stringify(['OK', evt.id, okAuth, okAuth ? '' : 'auth failed']));
    } else if (msg[0] === 'EVENT') {
      const event = msg[1];
      if (!relayState.authedSockets.has(ws)) {
        ws.send(JSON.stringify(['OK', event.id, false, 'auth-required: publish']));
        return;
      }
      const verdict = relayAccepts(event);
      if (verdict.ok && verifyEvent(event)) {
        relayState.events.push(event);
        broadcast(event);
        ws.send(JSON.stringify(['OK', event.id, true, '']));
      } else {
        ws.send(JSON.stringify(['OK', event.id, false, verdict.reason || 'invalid: bad signature']));
      }
    } else if (msg[0] === 'REQ') {
      const [, subId, ...filters] = msg;
      relayState.subs.push({ ws, subId, filters });
      // Serve stored kind:0 profile requests immediately (none exist).
      ws.send(JSON.stringify(['EOSE', subId]));
    } else if (msg[0] === 'CLOSE') {
      const idx = relayState.subs.findIndex((s) => s.ws === ws && s.subId === msg[1]);
      if (idx >= 0) relayState.subs.splice(idx, 1);
    }
  });
  ws.on('close', () => relayState.authedSockets.delete(ws));
});

// ---------------------------------------------------------------------------
// Mock Slack Web API: records chat.postMessage calls, answers users.info.
// ---------------------------------------------------------------------------
const slackCalls = { postMessage: [] };
let postCounter = 0;
const slackServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('users.info')) {
      res.end(JSON.stringify({ ok: true, user: { real_name: 'Client Casey', name: 'casey' } }));
    } else if (req.url.includes('chat.postMessage')) {
      const params = new URLSearchParams(body);
      const call = Object.fromEntries(params.entries());
      slackCalls.postMessage.push(call);
      res.end(JSON.stringify({ ok: true, ts: `2000.${String(++postCounter).padStart(3, '0')}`, channel: call.channel }));
    } else {
      res.end(JSON.stringify({ ok: true }));
    }
  });
});

// ---------------------------------------------------------------------------
// Bridge process under test
// ---------------------------------------------------------------------------
let bridge;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-int-'));
const dbPath = path.join(dataDir, 'bridge.sqlite');

function sendSlackEvent(event) {
  const body = JSON.stringify({
    type: 'event_callback',
    team_id: 'T_TEST',
    event_id: `Ev${crypto.randomBytes(4).toString('hex')}`,
    event_time: Math.floor(Date.now() / 1000),
    event,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(`v0:${ts}:${body}`).digest('hex');
  return fetch(`http://127.0.0.1:${BRIDGE_PORT}/slack/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
    },
    body,
  });
}

// Generous timeout: these normally resolve in <1s, but CI boxes under load
// (e.g. compiling native deps in parallel) have produced flaky 5s misses.
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
  // Seed the DB: one installed workspace (encrypted token) + one mapping.
  const masterKey = loadMasterKey(MASTER_KEY_HEX);
  const seed = new BridgeDB(dbPath);
  seed.saveWorkspace('T_TEST', encryptSecret(masterKey, 'xoxb-test-token', 'T_TEST'), 'B_TEST', 'U_BOT');
  seed.mapChannel('C_TEST', BUZZ_CHANNEL, 'T_TEST');
  seed.close();

  slackServer.listen(SLACK_PORT);

  bridge = spawn('node', ['server.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(BRIDGE_PORT),
      SLACK_CLIENT_ID: '1.2',
      SLACK_CLIENT_SECRET: 'x',
      SLACK_SIGNING_SECRET: SIGNING_SECRET,
      PUBLIC_BASE_URL: 'https://example.com',
      BUZZ_RELAY_URL: `ws://127.0.0.1:${RELAY_PORT}`,
      BRIDGE_MASTER_KEY: MASTER_KEY_HEX,
      BRIDGE_DB: dbPath,
      SLACK_API_URL: `http://127.0.0.1:${SLACK_PORT}/api/`,
      BRIDGE_KEY_MODE: 'single',
    },
  });
  bridge.stdout.on('data', (d) => process.stdout.write(`[bridge] ${d}`));
  bridge.stderr.on('data', (d) => process.stderr.write(`[bridge!] ${d}`));

  await waitFor(() => relayState.subs.length > 0, 30000);
});

after(async () => {
  bridge?.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 500));
  relayServer.close();
  slackServer.close();
});

test('bridge authenticates to the relay via NIP-42', async () => {
  // The REQ (which before() waits on) can arrive before the AUTH response
  // finishes its round-trip — auth is eventual, so wait for it.
  await waitFor(() => relayState.authedSockets.size === 1);
  assert.equal(relayState.authedSockets.size, 1);
});

test('Slack message becomes an authed kind:9 with h tag', async () => {
  const res = await sendSlackEvent({
    type: 'message', channel: 'C_TEST', user: 'U_CLIENT', text: 'Hello :rocket: world', ts: '1000.100',
  });
  assert.equal(res.status, 200);

  const evt = await waitFor(() => relayState.events.find((e) => e.kind === 9));
  assert.ok(evt.tags.some((t) => t[0] === 'h' && t[1] === BUZZ_CHANNEL));
  assert.match(evt.content, /\[Slack - Client Casey\]: Hello 🚀 world/);
  assert.ok(!evt.tags.some((t) => t[0] === 'e'), 'top-level message must not carry a reply tag');
});

test('Slack thread reply carries a marked reply tag to the bridged parent', async () => {
  const parent = relayState.events.find((e) => e.kind === 9);
  await sendSlackEvent({
    type: 'message', channel: 'C_TEST', user: 'U_CLIENT', text: 'threaded answer',
    ts: '1000.200', thread_ts: '1000.100',
  });
  const reply = await waitFor(() =>
    relayState.events.find((e) => e.kind === 9 && e.tags.some((t) => t[0] === 'e'))
  );
  const eTag = reply.tags.find((t) => t[0] === 'e');
  assert.equal(eTag[1], parent.id);
  assert.equal(eTag[3], 'reply');
});

test('Buzz message routes back to Slack with attribution', async () => {
  const buzzUserKey = crypto.randomBytes(32);
  const buzzEvent = finalizeEvent({
    kind: 9,
    created_at: Math.floor(Date.now() / 1000) + 1,
    tags: [['h', BUZZ_CHANNEL]],
    content: 'Reply from the hive',
  }, Uint8Array.from(buzzUserKey));
  relayState.events.push(buzzEvent);
  broadcast(buzzEvent);

  const call = await waitFor(() => slackCalls.postMessage.find((c) => c.text?.includes('Reply from the hive')));
  assert.equal(call.channel, 'C_TEST');
  assert.equal(call.token, 'xoxb-test-token');
  assert.ok(!call.thread_ts, 'top-level Buzz message must not thread');
});

test('Buzz reply to a bridged Slack message lands in the Slack thread', async () => {
  const parent = relayState.events.find((e) => e.kind === 9 && e.content.includes('Hello'));
  const buzzEvent = finalizeEvent({
    kind: 9,
    created_at: Math.floor(Date.now() / 1000) + 2,
    tags: [['h', BUZZ_CHANNEL], ['e', parent.id, '', 'reply']],
    content: 'threaded from Buzz',
  }, Uint8Array.from(crypto.randomBytes(32)));
  relayState.events.push(buzzEvent);
  broadcast(buzzEvent);

  const call = await waitFor(() => slackCalls.postMessage.find((c) => c.text?.includes('threaded from Buzz')));
  assert.equal(call.thread_ts, '1000.100');
});

test('bridge-originated events are never echoed back to Slack', async () => {
  const bridged = relayState.events.filter((e) => e.content.startsWith('[Slack -'));
  assert.ok(bridged.length >= 2);
  // Deliver the bridge's own events back on the subscription, as a real
  // relay would; none may produce a Slack post.
  const countBefore = slackCalls.postMessage.length;
  for (const e of bridged) broadcast(e);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(slackCalls.postMessage.length, countBefore);
});

test('relay rejects kind:9 without an h tag (mock enforces Buzz contract)', () => {
  const bad = finalizeEvent({
    kind: 9, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'no h',
  }, Uint8Array.from(crypto.randomBytes(32)));
  assert.equal(relayAccepts(bad).ok, false);
});
