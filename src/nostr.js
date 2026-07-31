import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';

useWebSocketImplementation(WebSocket);

export const KIND_CHAT = 9; // NIP-29 chat message (Buzz's channel message kind)

// Client for a NIP-29 managed relay (buzz-relay). Handles NIP-42 auth via
// nostr-tools' onauth hook — the relay sends a proactive AUTH challenge and
// the hook signs the kind:22242 response with the bridge key.
export class BuzzClient {
  constructor({ url, authKey, onEvent, log = console }) {
    this.url = url;
    this.authKey = authKey;
    this.authPubkey = getPublicKey(authKey);
    this.onEvent = onEvent;
    this.log = log;
    this.relay = null;
    this.sub = null;
    this.subscribedChannels = [];
    this.closed = false;
  }

  async connect() {
    let attempt = 0;
    while (!this.closed) {
      try {
        this.relay = await Relay.connect(this.url, { enablePing: true, enableReconnect: false });
        this.relay.onauth = async (evt) => finalizeEvent(evt, this.authKey);
        this.relay.onclose = () => {
          if (this.closed) return;
          this.log.warn('Buzz relay connection closed — reconnecting…');
          setTimeout(() => this.connect().then(() => this.subscribe(this.subscribedChannels)), 2000);
        };
        this.log.log(`🔌 Connected to Buzz relay ${this.url}`);
        return;
      } catch (e) {
        const delay = Math.min(30000, 2000 * 2 ** attempt++);
        // nostr-tools sometimes rejects with a bare string or event object
        const reason = e?.message || (typeof e === 'string' ? e : 'connection failed');
        this.log.error(`Relay connect failed (${reason}), retrying in ${delay / 1000}s`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // Publish a chat message into a Buzz channel. `parentEventId` threads it
  // as a NIP-10 marked reply; Slack threads are flat so the parent is always
  // the thread root. Returns the signed event (id included).
  async publishChatMessage({ buzzChannelId, content, parentEventId, signerKey }) {
    const tags = [['h', buzzChannelId]];
    if (parentEventId) tags.push(['e', parentEventId, '', 'reply']);
    const event = finalizeEvent(
      { kind: KIND_CHAT, created_at: Math.floor(Date.now() / 1000), tags, content },
      signerKey ?? this.authKey
    );
    await this.publishWithAuthRetry(event);
    return event;
  }

  // A managed relay may answer a publish with auth-required: before the AUTH
  // round-trip completes. Authenticate and retry once.
  async publishWithAuthRetry(event) {
    try {
      await this.relay.publish(event);
    } catch (e) {
      if (String(e.message || e).startsWith('auth-required')) {
        await this.relay.auth(async (evt) => finalizeEvent(evt, this.authKey));
        await this.relay.publish(event);
      } else {
        throw e;
      }
    }
  }

  // Subscribe to chat messages across all mapped Buzz channels. Re-invoked
  // whenever the mapping set changes; closes any prior subscription.
  subscribe(buzzChannelIds) {
    this.subscribedChannels = buzzChannelIds;
    if (this.sub) {
      this.sub.close();
      this.sub = null;
    }
    if (!this.relay?.connected || buzzChannelIds.length === 0) return;

    this.sub = this.relay.subscribe(
      [{ kinds: [KIND_CHAT], '#h': buzzChannelIds, since: Math.floor(Date.now() / 1000) }],
      {
        onevent: (event) => {
          Promise.resolve(this.onEvent(event)).catch((e) =>
            this.log.error('Buzz event handler faulted:', e.message)
          );
        },
      }
    );
    this.log.log(`📡 Subscribed to ${buzzChannelIds.length} Buzz channel(s).`);
  }

  // Fetch a kind:0 profile name for display attribution, best-effort.
  fetchProfileName(pubkey, timeoutMs = 3000) {
    return new Promise((resolve) => {
      if (!this.relay?.connected) return resolve(undefined);
      let settled = false;
      const finish = (value) => {
        if (!settled) { settled = true; resolve(value); }
      };
      const sub = this.relay.subscribe([{ kinds: [0], authors: [pubkey], limit: 1 }], {
        onevent: (evt) => {
          try {
            const meta = JSON.parse(evt.content);
            finish(meta.display_name || meta.name);
          } catch { finish(undefined); }
          sub.close();
        },
        oneose: () => { finish(undefined); sub.close(); },
      });
      setTimeout(() => finish(undefined), timeoutMs);
    });
  }

  close() {
    this.closed = true;
    if (this.sub) this.sub.close();
    if (this.relay) {
      this.relay.onclose = null;
      this.relay.close();
    }
  }
}
