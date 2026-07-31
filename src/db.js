import DatabaseCtor from 'better-sqlite3';

// SQLite persistence: workspaces (encrypted bot tokens), channel mappings,
// user directory (with derived Nostr pubkeys), and the message-id map that
// makes threading work in both directions.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  team_id       TEXT PRIMARY KEY,
  bot_token_enc TEXT NOT NULL,
  bot_id        TEXT,
  bot_user_id   TEXT,
  installed_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  slack_channel_id TEXT PRIMARY KEY,
  buzz_channel_id  TEXT NOT NULL UNIQUE,
  team_id          TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS slack_users (
  slack_user_id TEXT PRIMARY KEY,
  team_id       TEXT,
  display_name  TEXT,
  pubkey        TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS messages (
  slack_channel_id TEXT NOT NULL,
  slack_ts         TEXT NOT NULL,
  nostr_event_id   TEXT NOT NULL UNIQUE,
  direction        TEXT NOT NULL CHECK (direction IN ('s2b','b2s')),
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (slack_channel_id, slack_ts)
);
CREATE INDEX IF NOT EXISTS idx_messages_event ON messages (nostr_event_id);
CREATE TABLE IF NOT EXISTS buzz_profiles (
  pubkey     TEXT PRIMARY KEY,
  name       TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class BridgeDB {
  constructor(path) {
    this.db = new DatabaseCtor(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);

    this.stmts = {
      upsertWorkspace: this.db.prepare(
        `INSERT INTO workspaces (team_id, bot_token_enc, bot_id, bot_user_id, installed_at)
         VALUES (@team_id, @bot_token_enc, @bot_id, @bot_user_id, @installed_at)
         ON CONFLICT(team_id) DO UPDATE SET
           bot_token_enc = excluded.bot_token_enc,
           bot_id = excluded.bot_id,
           bot_user_id = excluded.bot_user_id`
      ),
      getWorkspace: this.db.prepare('SELECT * FROM workspaces WHERE team_id = ?'),
      deleteWorkspace: this.db.prepare('DELETE FROM workspaces WHERE team_id = ?'),
      firstWorkspace: this.db.prepare('SELECT * FROM workspaces ORDER BY installed_at LIMIT 1'),

      upsertChannel: this.db.prepare(
        `INSERT INTO channels (slack_channel_id, buzz_channel_id, team_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(slack_channel_id) DO UPDATE SET
           buzz_channel_id = excluded.buzz_channel_id, team_id = excluded.team_id`
      ),
      channelBySlack: this.db.prepare('SELECT * FROM channels WHERE slack_channel_id = ?'),
      channelByBuzz: this.db.prepare('SELECT * FROM channels WHERE buzz_channel_id = ?'),
      allChannels: this.db.prepare('SELECT * FROM channels'),

      upsertUser: this.db.prepare(
        `INSERT INTO slack_users (slack_user_id, team_id, display_name, pubkey)
         VALUES (@slack_user_id, @team_id, @display_name, @pubkey)
         ON CONFLICT(slack_user_id) DO UPDATE SET
           display_name = COALESCE(excluded.display_name, slack_users.display_name),
           pubkey = COALESCE(excluded.pubkey, slack_users.pubkey)`
      ),
      getUser: this.db.prepare('SELECT * FROM slack_users WHERE slack_user_id = ?'),
      userByPubkey: this.db.prepare('SELECT * FROM slack_users WHERE pubkey = ?'),

      insertMessage: this.db.prepare(
        `INSERT OR IGNORE INTO messages (slack_channel_id, slack_ts, nostr_event_id, direction, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ),
      messageBySlackTs: this.db.prepare('SELECT * FROM messages WHERE slack_channel_id = ? AND slack_ts = ?'),
      messageByEventId: this.db.prepare('SELECT * FROM messages WHERE nostr_event_id = ?'),

      upsertProfile: this.db.prepare(
        `INSERT INTO buzz_profiles (pubkey, name, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(pubkey) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
      ),
      getProfile: this.db.prepare('SELECT * FROM buzz_profiles WHERE pubkey = ?'),

      getSetting: this.db.prepare('SELECT value FROM settings WHERE key = ?'),
      setSetting: this.db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ),
    };
  }

  saveWorkspace(teamId, botTokenEnc, botId, botUserId) {
    this.stmts.upsertWorkspace.run({
      team_id: teamId, bot_token_enc: botTokenEnc, bot_id: botId,
      bot_user_id: botUserId, installed_at: Date.now(),
    });
  }
  getWorkspace(teamId) { return this.stmts.getWorkspace.get(teamId); }
  deleteWorkspace(teamId) { this.stmts.deleteWorkspace.run(teamId); }
  firstWorkspace() { return this.stmts.firstWorkspace.get(); }

  mapChannel(slackId, buzzId, teamId) { this.stmts.upsertChannel.run(slackId, buzzId, teamId, Date.now()); }
  channelBySlack(slackId) { return this.stmts.channelBySlack.get(slackId); }
  channelByBuzz(buzzId) { return this.stmts.channelByBuzz.get(buzzId); }
  allChannels() { return this.stmts.allChannels.all(); }

  saveUser({ slackUserId, teamId = null, displayName = null, pubkey = null }) {
    this.stmts.upsertUser.run({ slack_user_id: slackUserId, team_id: teamId, display_name: displayName, pubkey });
  }
  getUser(slackUserId) { return this.stmts.getUser.get(slackUserId); }
  userByPubkey(pubkey) { return this.stmts.userByPubkey.get(pubkey); }

  recordMessage(slackChannelId, slackTs, eventId, direction) {
    this.stmts.insertMessage.run(slackChannelId, slackTs, eventId, direction, Date.now());
  }
  eventIdForSlackTs(slackChannelId, slackTs) {
    return this.stmts.messageBySlackTs.get(slackChannelId, slackTs)?.nostr_event_id;
  }
  slackRefForEventId(eventId) { return this.stmts.messageByEventId.get(eventId); }

  saveProfile(pubkey, name) { this.stmts.upsertProfile.run(pubkey, name, Date.now()); }
  profileName(pubkey) { return this.stmts.getProfile.get(pubkey)?.name; }

  getSetting(key) { return this.stmts.getSetting.get(key)?.value; }
  setSetting(key, value) { this.stmts.setSetting.run(key, value); }

  close() { this.db.close(); }
}
