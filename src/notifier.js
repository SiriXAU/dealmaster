import { execFile } from 'child_process';

const BRAND = {
  color: 0xFF6600,
  iconUrl: 'https://www.ozbargain.com.au/themes/ozbargain/logo-icon-256.png',
  footerText: 'OzBargain',
};

/**
 * Sends a notification for a single deal to all configured URLs.
 * Discord URLs (discord://id/token) receive a rich embed via the webhook API.
 * All other URLs are sent via the Apprise CLI.
 *
 * @param {Object} deal   - Normalized deal object
 * @param {Object} config - App config (appriseUrls)
 * @returns {Promise<boolean>} true if all destinations succeeded
 */
export async function sendDealNotification(deal, config) {
  const discordUrls = [];
  const appriseUrls = [];

  for (const url of config.appriseUrls) {
    const webhookUrl = parseDiscordUrl(url);
    if (webhookUrl) {
      discordUrls.push(webhookUrl);
    } else {
      appriseUrls.push(url);
    }
  }

  const results = await Promise.all([
    ...discordUrls.map(webhookUrl => sendDiscordEmbed(deal, webhookUrl)),
    appriseUrls.length > 0 ? sendApprise(deal, appriseUrls) : Promise.resolve(true),
  ]);

  return results.every(Boolean);
}

/**
 * Converts a discord:// Apprise URL to a Discord webhook HTTPS URL.
 * discord://webhook_id/webhook_token → https://discord.com/api/webhooks/id/token
 * Returns null if the URL is not a discord:// URL.
 */
function parseDiscordUrl(url) {
  const match = url.match(/^discord:\/\/([^/]+)\/(.+)$/i);
  if (!match) return null;
  return `https://discord.com/api/webhooks/${match[1]}/${match[2]}`;
}

/**
 * Posts a rich Discord embed for the given deal.
 */
async function sendDiscordEmbed(deal, webhookUrl) {
  const embed = buildEmbed(deal);
  const payload = {
    username: 'Dealmaster',
    avatar_url: BRAND.iconUrl,
    embeds: [embed],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[notifier] Discord returned ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notifier] Failed to send Discord embed: ${err.message}`);
    return false;
  }
}

/**
 * Builds a Discord embed object for the given deal.
 */
function buildEmbed(deal) {
  const title = truncate(deal.title, 256);
  const description = truncate(deal.description, 300) || 'No description available.';

  // Always emit exactly 3 inline fields per row so Discord's grid stays aligned.
  // Row 1: Price | Store | Delivery
  // Row 2: Category | Votes | Posted by
  // Row 3 (optional): Expires — only added when present; shown alone, full-width
  const inline = (name, value) => ({ name, value, inline: true });

  const fields = [
    inline('Price',     deal.price    || '—'),
    inline('Store',     deal.store    || '—'),
    inline('Delivery',  deal.delivery || '—'),
    inline('Category',  deal.category || 'Uncategorised'),
    inline('Votes',     String(deal.votes)),
    inline('Posted by', deal.author   || 'Unknown'),
  ];

  if (deal.expiry) {
    const expiryLabel = formatExpiry(deal.expiry);
    if (expiryLabel) {
      fields.push({ name: 'Expires', value: expiryLabel, inline: false });
    }
  }

  const embed = {
    title,
    ...(deal.link ? { url: deal.link } : {}),
    description,
    color: BRAND.color,
    fields,
    footer: {
      text: BRAND.footerText,
      icon_url: BRAND.iconUrl,
    },
    timestamp: deal.pubDate ? new Date(deal.pubDate).toISOString() : new Date().toISOString(),
  };

  embed.thumbnail = { url: deal.imageUrl?.startsWith('http') ? deal.imageUrl : BRAND.iconUrl };

  return embed;
}

/**
 * Formats an expiry date/string for display. Returns null if unparseable.
 */
function formatExpiry(expiry) {
  const d = new Date(expiry);
  if (isNaN(d.getTime())) return String(expiry);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Sends a notification to all non-Discord URLs via the Apprise CLI.
 */
function sendApprise(deal, urls) {
  const title = truncate(deal.title, 250);
  const parts = [truncate(deal.description, 300) || 'No description available.'];

  const meta = [];
  if (deal.price) meta.push(`Price: ${deal.price}`);
  if (deal.store) meta.push(`Store: ${deal.store}`);
  if (deal.delivery) meta.push(`Delivery: ${deal.delivery}`);
  meta.push(`Category: ${deal.category || 'Uncategorised'}`);
  meta.push(`Votes: ${deal.votes}`);
  meta.push(`By: ${deal.author || 'Unknown'}`);
  if (deal.expiry) meta.push(`Expires: ${deal.expiry}`);

  parts.push('');
  parts.push(meta.join(' | '));
  if (deal.link) parts.push(deal.link);

  const body = parts.join('\n');

  return new Promise(resolve => {
    execFile(
      'apprise',
      ['--title', title, '--body', body, ...urls],
      (err, _stdout, stderr) => {
        if (err) {
          console.error(`[notifier] Apprise exited with code ${err.code}: ${stderr}`);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

/**
 * Truncates a string to maxLen characters, appending '…' if truncated.
 */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Waits for the given number of milliseconds.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
