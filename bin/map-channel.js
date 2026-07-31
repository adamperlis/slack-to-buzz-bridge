#!/usr/bin/env node
// Map a Slack channel to a Buzz channel: npm run map -- <slack-id> <buzz-uuid> [team-id]
import 'dotenv/config';
import { BridgeDB } from '../src/db.js';

const [slackId, buzzId, teamArg] = process.argv.slice(2);
if (!slackId || !buzzId) {
  console.error('Usage: npm run map -- <slack-channel-id> <buzz-channel-uuid> [team-id]');
  process.exit(1);
}
if (!/^[CG][A-Z0-9]+$/.test(slackId)) {
  console.error(`"${slackId}" does not look like a Slack channel id (C… or G…).`);
  process.exit(1);
}

const db = new BridgeDB(process.env.BRIDGE_DB || './data/bridge.sqlite');
const teamId = teamArg || db.firstWorkspace()?.team_id;
if (!teamId) {
  console.error('No installed workspace found and no team-id given. Install the app first.');
  process.exit(1);
}

db.mapChannel(slackId, buzzId, teamId);
console.log(`Mapped ${slackId} (team ${teamId}) ⇄ ${buzzId}`);
console.log('The running bridge picks this up within 15 seconds.');
db.close();
