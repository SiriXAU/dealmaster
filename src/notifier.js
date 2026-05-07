import { execFile } from 'child_process';
import { createLogger } from './logger.js';

const log = createLogger('notifier');

const SOURCE_BRANDS = {
  ozbargain: {
    color:      0xFF6600,
    iconUrl:    'https://www.ozbargain.com.au/themes/ozbargain/logo-icon-256.png',
    footerText: 'OzBargain',
  },
  gamerpower: {
    color:      0xEF4444,
    iconUrl:    'https://www.gamerpower.com/favicon.ico',
    footerText: 'GamerPower · Freebies',
  },
  'gamerpower-games': {
    color:      0xEF4444,
    iconUrl:    'https://www.gamerpower.com/favicon.ico',
    footerText: 'GamerPower · Games',
  },
  'gamerpower-loot': {
    color:      0xEF4444,
    iconUrl:    'https://www.gamerpower.com/favicon.ico',
    footerText: 'GamerPower · Loot',
  },
  epicbundle: {
    color:      0x8B5CF6,
    iconUrl:    'https://www.epicbundle.com/favicon.ico',
    footerText: 'EpicBundle',
  },
};

const DIGEST_BRAND = {
  color:      0x18181B,
  iconUrl:    'https://www.ozbargain.com.au/themes/ozbargain/logo-icon-256.png',
  footerText: 'Dealmaster · Digest',
};

function getBrand(source) {
  return SOURCE_BRANDS[source] ?? SOURCE_BRANDS.ozbargain;
}

const _lastDiscordSend = new Map();

/**
 * Sends a notification for a single deal to the given Apprise URLs.
 * Discord URLs (discord://id/token) receive a rich embed via the webhook API.
 * All other URLs are sent via the Apprise CLI.
 *
 * Backward-compatible: a config-shaped second arg (with `appriseUrls`) is also accepted.
 */
export async function sendDealNotification(deal, urlsOrConfig) {
  const urls = Array.isArray(urlsOrConfig)
    ? urlsOrConfig
    : (urlsOrConfig?.appriseUrls ?? []);
  return dispatch(urls, async (webhookUrl) => sendDiscordEmbed(deal, webhookUrl), async (apprise) => sendAppriseDeal(deal, apprise));
}

/**
 * Sends a single digest notification summarising up to N deals.
 * Discord targets get one embed with up to 10 fields (one per deal); other
 * targets get a markdown bullet list via Apprise.
 */
export async function sendDigest(deals, urls, profileName) {
  if (!Array.isArray(deals) || deals.length === 0 || !Array.isArray(urls) || urls.length === 0) {
    return { ok: true, results: [] };
  }
  return dispatch(
    urls,
    async (webhookUrl) => sendDiscordDigest(deals, webhookUrl, profileName),
    async (apprise)    => sendAppriseDigest(deals, apprise, profileName),
  );
}

async function dispatch(urls, sendDiscord, sendApprise) {
  const discordUrls = [];
  const appriseUrls = [];

  for (const url of urls) {
    const webhookUrl = parseDiscordUrl(url);
    if (webhookUrl) {
      discordUrls.push(webhookUrl);
    } else {
      appriseUrls.push(url);
    }
  }

  const discordResults = await Promise.all(
    discordUrls.map(async webhookUrl => ({
      url: webhookUrl,
      ok:  await sendDiscord(webhookUrl),
    }))
  );

  const appriseOk = appriseUrls.length > 0 ? await sendApprise(appriseUrls) : true;

  const allResults = [
    ...discordResults,
    ...appriseUrls.map(u => ({ url: u, ok: appriseOk })),
  ];

  return { ok: allResults.every(r => r.ok), results: allResults };
}

/**
 * Converts a discord:// Apprise URL to a Discord webhook HTTPS URL.
 */
export function parseDiscordUrl(url) {
  const match = String(url ?? '').match(/^discord:\/\/([^/]+)\/(.+)$/i);
  if (!match) return null;
  return `https://discord.com/api/webhooks/${match[1]}/${match[2]}`;
}

async function postDiscord(webhookUrl, payload) {
  const MIN_INTERVAL_MS = 1000;
  const last = _lastDiscordSend.get(webhookUrl) ?? 0;
  const wait = MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);

  const MAX_ATTEMPTS = 2;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      _lastDiscordSend.set(webhookUrl, Date.now());
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return true;
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        const delay = retryAfter ? parseFloat(retryAfter) * 1000 : 2000;
        log.warn(`Discord 429 rate limited, waiting ${delay}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
        await sleep(delay);
        continue;
      }
      const body = await res.text().catch(() => '');
      log.error(`Discord returned ${res.status}: ${body}`);
      return false;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS - 1) {
        log.warn(`Discord network error, retrying (${err.message})`);
        await sleep(1000);
        continue;
      }
      log.error(`Failed to post to Discord: ${err.message}`);
      return false;
    }
  }
  return false;
}

async function sendDiscordEmbed(deal, webhookUrl) {
  const embed = buildEmbed(deal);
  return postDiscord(webhookUrl, {
    username: 'Dealmaster',
    avatar_url: getBrand(deal.source).iconUrl,
    embeds: [embed],
  });
}

async function sendDiscordDigest(deals, webhookUrl, profileName) {
  const embed = buildDigestEmbed(deals, profileName);
  return postDiscord(webhookUrl, {
    username: 'Dealmaster',
    avatar_url: DIGEST_BRAND.iconUrl,
    embeds: [embed],
  });
}

/**
 * Builds a Discord embed object for the given deal.
 * OzBargain embeds show Price/Store/Delivery + Category/Votes/Author.
 * Gaming source embeds show Price/Store/Category + Type/Source/Posted.
 */
export function buildEmbed(deal) {
  const brand = getBrand(deal.source);
  const title = truncate(deal.title, 256);
  const description = truncate(deal.description, 300) || 'No description available.';

  const inline = (name, value) => ({ name, value, inline: true });

  let fields;
  if (deal.source === 'ozbargain') {
    fields = [
      inline('Price',     deal.price    || '—'),
      inline('Store',     deal.store    || '—'),
      inline('Delivery',  deal.delivery || '—'),
      inline('Category',  deal.category || 'Uncategorised'),
      inline('Votes',     String(deal.votes)),
      inline('Posted by', deal.author   || 'Unknown'),
    ];
    if (deal.expiry) {
      const expiryLabel = formatExpiry(deal.expiry);
      if (expiryLabel) fields.push({ name: 'Expires', value: expiryLabel, inline: false });
    }
  } else {
    const posted = deal.pubDate
      ? new Date(deal.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
      : '—';
    fields = [
      inline('Price',    deal.price    || 'Free'),
      inline('Store',    deal.store    || '—'),
      inline('Category', deal.category || 'Gaming'),
      inline('Type',     deal.type     || 'Deal'),
      inline('Source',   brand.footerText),
      inline('Posted',   posted),
    ];
  }

  const embed = {
    title,
    ...(deal.link ? { url: deal.link } : {}),
    description,
    color: brand.color,
    fields,
    footer: {
      text:     brand.footerText,
      icon_url: brand.iconUrl,
    },
    timestamp: deal.pubDate ? new Date(deal.pubDate).toISOString() : new Date().toISOString(),
  };

  embed.thumbnail = { url: deal.imageUrl?.startsWith('http') ? deal.imageUrl : brand.iconUrl };

  return embed;
}

/**
 * Builds a Discord digest embed: one card listing up to 10 deals as inline
 * fields with their price + store + link. If more than 10, appends a footer note.
 */
export function buildDigestEmbed(deals, profileName) {
  const MAX_FIELDS = 10;
  const shown = deals.slice(0, MAX_FIELDS);
  const fields = shown.map(d => {
    const head = [d.price || '—', d.store || sourceLabel(d.source)].filter(Boolean).join(' · ');
    const value = d.link
      ? `[${truncate(d.title, 90)}](${d.link})\n${head}`
      : `${truncate(d.title, 90)}\n${head}`;
    return { name: '​', value: truncate(value, 1024), inline: false };
  });

  const overflow = deals.length - shown.length;
  const description = overflow > 0
    ? `${deals.length} new deals · showing first ${shown.length} (+${overflow} more)`
    : `${deals.length} new deal${deals.length === 1 ? '' : 's'}`;

  return {
    title: `Digest — ${profileName ?? 'Default'}`,
    description,
    color: DIGEST_BRAND.color,
    fields,
    footer: { text: DIGEST_BRAND.footerText, icon_url: DIGEST_BRAND.iconUrl },
    timestamp: new Date().toISOString(),
  };
}

function sourceLabel(source) {
  return SOURCE_BRANDS[source]?.footerText ?? source ?? 'Unknown';
}

function formatExpiry(expiry) {
  const d = new Date(expiry);
  if (isNaN(d.getTime())) return String(expiry);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function sendAppriseDeal(deal, urls) {
  const title = truncate(deal.title, 250);
  const parts = [truncate(deal.description, 300) || 'No description available.'];

  const meta = [];
  if (deal.price) meta.push(`Price: ${deal.price}`);
  if (deal.store) meta.push(`Store: ${deal.store}`);
  if (deal.source === 'ozbargain') {
    if (deal.delivery) meta.push(`Delivery: ${deal.delivery}`);
    meta.push(`Category: ${deal.category || 'Uncategorised'}`);
    meta.push(`Votes: ${deal.votes}`);
    meta.push(`By: ${deal.author || 'Unknown'}`);
    if (deal.expiry) meta.push(`Expires: ${deal.expiry}`);
  } else {
    meta.push(`Category: ${deal.category || 'Gaming'}`);
    meta.push(`Type: ${deal.type || 'Deal'}`);
    meta.push(`Source: ${getBrand(deal.source).footerText}`);
  }

  parts.push('');
  parts.push(meta.join(' | '));
  if (deal.link) parts.push(deal.link);

  return runApprise(title, parts.join('\n'), urls);
}

function sendAppriseDigest(deals, urls, profileName) {
  const title = `Dealmaster digest — ${deals.length} deal${deals.length === 1 ? '' : 's'}`;
  const lines = [`Profile: ${profileName ?? 'Default'}`, ''];
  for (const d of deals) {
    const head = [d.price || '—', d.store || sourceLabel(d.source)].filter(Boolean).join(' · ');
    if (d.link) {
      lines.push(`• ${d.title} — ${head}\n  ${d.link}`);
    } else {
      lines.push(`• ${d.title} — ${head}`);
    }
  }
  return runApprise(title, lines.join('\n'), urls);
}

function runApprise(title, body, urls) {
  return new Promise(resolve => {
    execFile(
      'apprise',
      ['--title', title, '--body', body, ...urls],
      (err, _stdout, stderr) => {
        if (err) {
          log.error(`Apprise exited with code ${err.code}: ${stderr}`);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
