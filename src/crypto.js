import crypto from 'node:crypto';
import { getPublicKey } from 'nostr-tools/pure';

// AES-256-GCM encryption for Slack tokens at rest. AAD binds each ciphertext
// to its tenant so a token encrypted for one workspace cannot be swapped into
// another workspace's row undetected. NIST SP 800-38D: random 96-bit IVs are
// safe well below 2^32 encryptions per key — we do a handful per install.
const KEY_VERSION = 1;

export function loadMasterKey(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex || '')) {
    throw new Error('BRIDGE_MASTER_KEY must be 64 hex characters (32 bytes). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(masterKey, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: KEY_VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  });
}

export function decryptSecret(masterKey, encoded, aad) {
  const { v, iv, tag, ct } = JSON.parse(encoded);
  if (v !== KEY_VERSION) throw new Error(`Unknown ciphertext key version ${v}`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

// Deterministic per-user Nostr keys, derived from the bridge master key via
// HKDF so no per-user secret needs storing. The counter loop guards the
// astronomically-unlikely case where the derived scalar falls outside the
// secp256k1 group order.
export function deriveUserKey(masterKey, slackUserId) {
  for (let counter = 0; counter < 8; counter++) {
    const derived = Buffer.from(
      crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), `slack-buzz-user:${slackUserId}:${counter}`, 32)
    );
    const candidate = Uint8Array.from(derived);
    try {
      getPublicKey(candidate); // throws if out of curve order
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`Key derivation failed for ${slackUserId}`);
}
