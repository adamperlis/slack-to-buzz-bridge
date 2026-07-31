import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPublicKey } from 'nostr-tools/pure';

import { loadMasterKey, encryptSecret, decryptSecret, deriveUserKey } from '../src/crypto.js';
import { decodeMrkdwn, renderRichText, transformEmojis, slackMessageToPlain } from '../src/slack-format.js';
import { BridgeDB } from '../src/db.js';

const masterKey = loadMasterKey(crypto.randomBytes(32).toString('hex'));

describe('crypto', () => {
  test('encrypts and decrypts a token bound to its tenant', () => {
    const enc = encryptSecret(masterKey, 'xoxb-secret-token', 'T111');
    assert.equal(decryptSecret(masterKey, enc, 'T111'), 'xoxb-secret-token');
  });

  test('rejects decryption under a different tenant AAD', () => {
    const enc = encryptSecret(masterKey, 'xoxb-secret-token', 'T111');
    assert.throws(() => decryptSecret(masterKey, enc, 'T222'));
  });

  test('rejects tampered ciphertext', () => {
    const enc = JSON.parse(encryptSecret(masterKey, 'xoxb-secret-token', 'T111'));
    const ct = Buffer.from(enc.ct, 'base64');
    ct[0] ^= 0xff;
    enc.ct = ct.toString('base64');
    assert.throws(() => decryptSecret(masterKey, JSON.stringify(enc), 'T111'));
  });

  test('derives deterministic, distinct, valid per-user keys', () => {
    const k1 = deriveUserKey(masterKey, 'U111');
    const k1again = deriveUserKey(masterKey, 'U111');
    const k2 = deriveUserKey(masterKey, 'U222');
    assert.deepEqual(k1, k1again);
    assert.notDeepEqual(k1, k2);
    assert.equal(getPublicKey(k1).length, 64);
  });

  test('rejects malformed master keys', () => {
    assert.throws(() => loadMasterKey('short'));
    assert.throws(() => loadMasterKey(undefined));
  });
});

describe('slack-format', () => {
  test('decodes mrkdwn mentions, links, and entities', () => {
    const out = decodeMrkdwn(
      'Hey <@U123ABC> see <https://example.com|the doc> in <#C999|general> &amp; &lt;tags&gt;',
      (id) => (id === 'U123ABC' ? 'John Doe' : undefined)
    );
    assert.equal(out, 'Hey @John Doe see the doc (https://example.com) in #general & <tags>');
  });

  test('converts known emoji and strips unknown custom emoji', () => {
    assert.equal(transformEmojis('deploy :rocket: :party_wizard: done :+1:'), 'deploy 🚀  done 👍');
  });

  test('renders rich_text lists, quotes, and code', () => {
    const blocks = [{
      type: 'rich_text',
      elements: [
        { type: 'rich_text_section', elements: [{ type: 'text', text: 'Plan:' }] },
        {
          type: 'rich_text_list', style: 'ordered',
          elements: [
            { type: 'rich_text_section', elements: [{ type: 'text', text: 'ship' }] },
            { type: 'rich_text_section', elements: [{ type: 'text', text: 'iterate' }] },
          ],
        },
        { type: 'rich_text_quote', elements: [{ type: 'text', text: 'wise words' }] },
        { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'const x = 1;' }] },
      ],
    }];
    const out = renderRichText(blocks);
    assert.match(out, /Plan:/);
    assert.match(out, /1\. ship/);
    assert.match(out, /2\. iterate/);
    assert.match(out, /> wise words/);
    assert.match(out, /```\nconst x = 1;\n```/);
  });

  test('renders rich_text user mentions and emoji elements', () => {
    const blocks = [{
      type: 'rich_text',
      elements: [{
        type: 'rich_text_section',
        elements: [
          { type: 'user', user_id: 'U1' },
          { type: 'text', text: ' says ' },
          { type: 'emoji', name: 'fire' },
        ],
      }],
    }];
    assert.equal(renderRichText(blocks, () => 'Jane'), '@Jane says 🔥');
  });

  test('prefers rich_text blocks over the escaped text field', () => {
    const message = {
      text: 'fallback &amp; escaped',
      blocks: [{
        type: 'rich_text',
        elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'the real content' }] }],
      }],
    };
    assert.equal(slackMessageToPlain(message), 'the real content');
  });
});

describe('db', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-db-'));
  const db = new BridgeDB(path.join(dir, 'test.sqlite'));

  test('round-trips workspaces, channels, users', () => {
    db.saveWorkspace('T1', 'enc-token', 'B1', 'U_BOT');
    assert.equal(db.getWorkspace('T1').bot_user_id, 'U_BOT');

    db.mapChannel('C1', 'buzz-uuid-1', 'T1');
    assert.equal(db.channelBySlack('C1').buzz_channel_id, 'buzz-uuid-1');
    assert.equal(db.channelByBuzz('buzz-uuid-1').slack_channel_id, 'C1');

    db.saveUser({ slackUserId: 'U1', teamId: 'T1', displayName: 'Jane', pubkey: 'ab'.repeat(32) });
    assert.equal(db.getUser('U1').display_name, 'Jane');
    assert.equal(db.userByPubkey('ab'.repeat(32)).slack_user_id, 'U1');
  });

  test('maps message ids in both directions for threading', () => {
    db.recordMessage('C1', '1000.001', 'evt-aaa', 's2b');
    db.recordMessage('C1', '1000.002', 'evt-bbb', 'b2s');
    assert.equal(db.eventIdForSlackTs('C1', '1000.001'), 'evt-aaa');
    assert.equal(db.slackRefForEventId('evt-bbb').slack_ts, '1000.002');
    // duplicate insert is ignored, not an error
    db.recordMessage('C1', '1000.001', 'evt-aaa', 's2b');
  });
});
