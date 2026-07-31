import { createRequire } from 'node:module';

// Slack's emoji shortcodes are, per Slack's own docs, taken from
// iamcal/emoji-data — so this dataset gives an exact shortcode→unicode map
// instead of a hand-curated subset.
const require = createRequire(import.meta.url);
const emojiData = require('emoji-datasource/emoji.json');

const SHORTCODE_TO_UNICODE = new Map();
for (const e of emojiData) {
  const unicode = e.unified.split('-').map((cp) => String.fromCodePoint(parseInt(cp, 16))).join('');
  for (const name of e.short_names || [e.short_name]) {
    SHORTCODE_TO_UNICODE.set(name, unicode);
  }
}

export function emojiShortcodeToUnicode(code) {
  return SHORTCODE_TO_UNICODE.get(code.toLowerCase());
}

export function transformEmojis(text) {
  // Known shortcodes become unicode; unknown/custom emoji and skin-tone
  // modifier fragments are stripped so Buzz never renders raw :noise:.
  return text.replace(/:([a-z0-9_+\-']+)(?:::skin-tone-\d)?:/gi, (m, code) => {
    return SHORTCODE_TO_UNICODE.get(code.toLowerCase()) ?? '';
  });
}

const ENTITY_MAP = { '&lt;': '<', '&gt;': '>', '&amp;': '&' };
function decodeEntities(text) {
  return text.replace(/&(?:lt|gt|amp);/g, (m) => ENTITY_MAP[m]);
}

// Fallback decoder for Slack's escaped mrkdwn `text` field, used when a
// message carries no rich_text block. `resolveUser` maps a Slack user id to
// a display name (may return undefined).
export function decodeMrkdwn(text, resolveUser = () => undefined) {
  return decodeEntities(
    text
      .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (m, id) => `@${resolveUser(id) || id}`)
      .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
      .replace(/<!(channel|here|everyone)(?:\|[^>]*)?>/g, '@$1')
      .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
      .replace(/<(https?:\/\/[^>]+)>/g, '$1')
  );
}

// Renders Slack rich_text blocks (the WYSIWYG output present on all
// user-composed messages) to plain text. Lists, quotes, and preformatted
// sections aren't expressible in mrkdwn, so this path preserves structure
// the fallback can't.
export function renderRichText(blocks, resolveUser = () => undefined) {
  const rich = (blocks || []).filter((b) => b.type === 'rich_text');
  if (rich.length === 0) return null;

  const renderElement = (el) => {
    switch (el.type) {
      case 'text': {
        let t = el.text;
        if (el.style?.code) t = `\`${t}\``;
        return t;
      }
      case 'emoji':
        return el.unicode
          ? el.unicode.split('-').map((cp) => String.fromCodePoint(parseInt(cp, 16))).join('')
          : SHORTCODE_TO_UNICODE.get(el.name) ?? '';
      case 'user':
        return `@${resolveUser(el.user_id) || el.user_id}`;
      case 'usergroup':
        return '@group';
      case 'channel':
        return `#${el.channel_id}`;
      case 'link':
        return el.text && el.text !== el.url ? `${el.text} (${el.url})` : el.url;
      case 'broadcast':
        return `@${el.range}`;
      case 'date':
        return el.fallback || '';
      default:
        return el.text || '';
    }
  };

  const renderSection = (section) => (section.elements || []).map(renderElement).join('');

  const parts = [];
  for (const block of rich) {
    for (const section of block.elements || []) {
      switch (section.type) {
        case 'rich_text_section':
          parts.push(renderSection(section));
          break;
        case 'rich_text_list': {
          const bullet = (i) => (section.style === 'ordered' ? `${i + 1}.` : '•');
          const indent = '  '.repeat(section.indent || 0);
          section.elements.forEach((item, i) => {
            parts.push(`${indent}${bullet(i)} ${renderSection(item)}`);
          });
          break;
        }
        case 'rich_text_quote':
          parts.push(renderSection(section).split('\n').map((l) => `> ${l}`).join('\n'));
          break;
        case 'rich_text_preformatted':
          parts.push('```\n' + renderSection(section) + '\n```');
          break;
        default:
          parts.push(renderSection(section));
      }
    }
  }
  return parts.join('\n');
}

// Full Slack message → plain text for Buzz. Prefers rich_text blocks,
// falls back to the escaped mrkdwn text field.
export function slackMessageToPlain(message, resolveUser) {
  const fromBlocks = renderRichText(message.blocks, resolveUser);
  const text = fromBlocks ?? decodeMrkdwn(message.text || '', resolveUser);
  return transformEmojis(text).trim();
}
