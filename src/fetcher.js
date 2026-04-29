import Parser from 'rss-parser';

const USER_AGENT = 'Mozilla/5.0 (compatible; dealmaster/1.0; +https://github.com/SiriXAU/dealmaster)';

const ozbParser = new Parser({
  customFields: {
    item: [
      ['ozb:meta', 'ozbMeta'],
      ['content:encoded', 'contentEncoded'],
    ],
  },
  requestOptions: { headers: { 'User-Agent': USER_AGENT } },
});

const genericParser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  },
  requestOptions: { headers: { 'User-Agent': USER_AGENT } },
});

const OZB_FEED_URL = 'https://www.ozbargain.com.au/deals/feed';

// GamerPower's RSS feeds produce malformed XML; use their JSON API instead.
const GAMERPOWER_API_BASE = 'https://www.gamerpower.com/api/giveaways';

export const GAMING_FEED_URLS = {
  epicbundle: 'https://epicbundle.com/feed',
};

/**
 * Fetches and parses the OzBargain RSS feed.
 * @returns {Promise<Array>} Array of normalized deal objects, or [] on error.
 */
export async function fetchDeals() {
  try {
    const feed = await ozbParser.parseURL(OZB_FEED_URL);
    return feed.items.map(normalizeOzbItem);
  } catch (err) {
    console.error(`[fetcher] Failed to fetch OzBargain feed: ${err.message}`);
    return [];
  }
}

async function fetchRssFeed(sourceId, url) {
  try {
    const feed = await genericParser.parseURL(url);
    return feed.items.map(item => normalizeGamingItem(item, sourceId));
  } catch (err) {
    console.error(`[fetcher] Failed to fetch ${sourceId} feed: ${err.message}`);
    return [];
  }
}

async function fetchGamerPower(sourceId, apiUrl) {
  try {
    const res = await fetch(apiUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(item => normalizeGamerPowerItem(item, sourceId));
  } catch (err) {
    console.error(`[fetcher] Failed to fetch ${sourceId} feed: ${err.message}`);
    return [];
  }
}

/**
 * Fetches deals from all enabled sources in parallel.
 * OzBargain is always included; gaming sources are gated by config.gamingSources.
 * @param {Object} config - App config (must include gamingSources)
 * @returns {Promise<Array>} Combined array of normalized deal objects.
 */
export async function fetchAllDeals(config) {
  const { gamingSources = {} } = config;
  const tasks = [fetchDeals()];
  if (gamingSources.gamerpower)      tasks.push(fetchGamerPower('gamerpower',       GAMERPOWER_API_BASE));
  if (gamingSources.gamerpowerGames) tasks.push(fetchGamerPower('gamerpower-games', `${GAMERPOWER_API_BASE}?type=game`));
  if (gamingSources.gamerpowerLoot)  tasks.push(fetchGamerPower('gamerpower-loot',  `${GAMERPOWER_API_BASE}?type=loot`));
  if (gamingSources.epicbundle)      tasks.push(fetchRssFeed('epicbundle',          GAMING_FEED_URLS.epicbundle));
  const results = await Promise.all(tasks);
  return results.flat();
}

// ── OzBargain helpers ─────────────────────────────────────────────────────────

/**
 * Extracts a plain string from a category value.
 * rss-parser returns XML elements with attributes as { _: "text", $: { attr } }
 * objects rather than plain strings.
 */
function extractCategory(raw) {
  if (!raw) return 'Uncategorised';
  if (typeof raw === 'string') return raw;
  return raw._ ?? 'Uncategorised';
}

/**
 * Extracts the store name from an OzBargain title.
 * Titles follow the pattern "Deal description @ Store Name"
 */
function extractStore(title) {
  const match = title?.match(/@\s*(.+)$/);
  return match ? match[1].trim() : null;
}

/**
 * Extracts the price from a title.
 * Looks for a $ amount, e.g. "$169", "$24.99", "$1,299"
 */
function extractPriceFromTitle(title) {
  const match = title?.match(/\$[\d,]+(?:\.\d{1,2})?/);
  return match ? match[0] : null;
}

/**
 * Extracts delivery methods mentioned in the title.
 * Returns a comma-joined string of terms found, e.g. "Delivered, C&C"
 */
function extractDelivery(title) {
  if (!title) return null;
  const methods = [];
  if (/\bdelivered\b/i.test(title)) methods.push('Delivered');
  if (/\bC&C\b|\bclick\s*&?\s*collect\b/i.test(title)) methods.push('C&C');
  if (/\bin[- ]?store\b/i.test(title)) methods.push('In-Store');
  if (/\bfree\s+shipping\b|\bfree\s+delivery\b/i.test(title)) methods.push('Free Shipping');
  return methods.length > 0 ? methods.join(', ') : null;
}

/**
 * Normalizes a raw OzBargain RSS item into a consistent deal shape.
 */
function normalizeOzbItem(item) {
  const meta  = item.ozbMeta ?? {};
  const attrs = meta['$'] ?? {};

  const votes    = parseInt(attrs.votes ?? meta.votes ?? '0', 10);
  const imageUrl = attrs.image ?? meta.image ?? null;
  const price    = attrs.price ?? extractPriceFromTitle(item.title) ?? null;
  const expiry   = attrs.expire ?? attrs.expiry ?? null;
  const title    = item.title ?? 'Unknown Deal';

  return {
    id:          item.guid ?? item.link,
    title,
    link:        item.link ?? '',
    category:    extractCategory(item.categories?.[0] ?? item.category),
    pubDate:     item.pubDate ?? item.isoDate ?? null,
    description: stripHtml(item.contentEncoded ?? item.content ?? item.summary ?? ''),
    votes:       isNaN(votes) ? 0 : votes,
    imageUrl,
    author:      item.creator ?? item['dc:creator'] ?? 'Unknown',
    price,
    expiry,
    store:       extractStore(title),
    delivery:    extractDelivery(title),
    source:      'ozbargain',
  };
}

// ── Gaming source helpers ─────────────────────────────────────────────────────

const GAMING_SOURCE_TYPE = {
  epicbundle: 'Bundle',
};

function extractMediaUrl(item) {
  const mc = item.mediaContent;
  if (mc) {
    const url = typeof mc === 'object' ? (mc['$']?.url ?? mc.url) : null;
    if (url) return url;
  }
  const mt = item.mediaThumbnail;
  if (mt) {
    const url = typeof mt === 'object' ? (mt['$']?.url ?? mt.url) : null;
    if (url) return url;
  }
  return item.enclosure?.url ?? null;
}

/**
 * Normalizes a raw RSS gaming item (game-deals, epicbundle) into a consistent deal shape.
 */
function normalizeGamingItem(item, sourceId) {
  const title   = item.title ?? 'Unknown Deal';
  const content = item.contentEncoded ?? item.content ?? item.summary ?? '';

  return {
    id:          item.guid ?? item.link ?? `${sourceId}:${title}`,
    title,
    link:        item.link ?? '',
    category:    extractCategory(item.categories?.[0] ?? item.category) || 'Gaming',
    pubDate:     item.pubDate ?? item.isoDate ?? null,
    description: stripHtml(content),
    votes:       0,
    imageUrl:    extractMediaUrl(item),
    author:      item.creator ?? item['dc:creator'] ?? null,
    price:       extractPriceFromTitle(title) ?? null,
    expiry:      null,
    store:       extractStore(title),
    delivery:    null,
    type:        GAMING_SOURCE_TYPE[sourceId] ?? 'Deal',
    source:      sourceId,
  };
}

/**
 * Normalizes a GamerPower JSON API item into a consistent deal shape.
 * API docs: https://www.gamerpower.com/api-read
 */
function normalizeGamerPowerItem(item, sourceId) {
  const worth   = item.worth === 'N/A' ? null : item.worth;
  const endDate = item.end_date === 'N/A' ? null : item.end_date;
  const type    = 'Freebie';

  return {
    id:          `gamerpower:${item.id}`,
    title:       item.title ?? 'Unknown Deal',
    link:        item.open_giveaway_url ?? item.gamerpower_url ?? '',
    category:    'Gaming',
    pubDate:     item.published_date ?? null,
    description: item.description ?? '',
    votes:       0,
    imageUrl:    item.thumbnail ?? item.image ?? null,
    author:      null,
    price:       worth ?? 'Free',
    expiry:      endDate,
    store:       null,
    delivery:    null,
    type,
    source:      sourceId,
  };
}

/**
 * Strips HTML tags and decodes common entities for plain-text output.
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
