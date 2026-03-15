import Parser from 'rss-parser';

const FEED_URL = 'https://www.ozbargain.com.au/deals/feed';
const USER_AGENT = 'Mozilla/5.0 (compatible; dealmaster/1.0; +https://github.com/SiriXAU/dealmaster)';

const parser = new Parser({
  customFields: {
    item: [
      ['ozb:meta', 'ozbMeta'],
      ['content:encoded', 'contentEncoded'],
    ],
  },
  requestOptions: {
    headers: {
      'User-Agent': USER_AGENT,
    },
  },
});

/**
 * Fetches and parses the OzBargain RSS feed.
 * @returns {Promise<Array>} Array of normalized deal objects, or [] on error.
 */
export async function fetchDeals() {
  try {
    const feed = await parser.parseURL(FEED_URL);
    return feed.items.map(normalizeItem);
  } catch (err) {
    console.error(`[fetcher] Failed to fetch feed: ${err.message}`);
    return [];
  }
}

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
 * Extracts the price from an OzBargain title.
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
 * Normalizes a raw RSS item into a consistent deal shape.
 */
function normalizeItem(item) {
  const meta = item.ozbMeta ?? {};
  const attrs = meta['$'] ?? {};

  const votes = parseInt(attrs.votes ?? meta.votes ?? '0', 10);
  const imageUrl = attrs.image ?? meta.image ?? null;

  // Price: prefer ozb:meta attribute, fall back to title extraction
  const price = attrs.price ?? extractPriceFromTitle(item.title) ?? null;

  // Expiry date from ozb:meta
  const expiry = attrs.expire ?? attrs.expiry ?? null;

  const title = item.title ?? 'Unknown Deal';

  return {
    id: item.guid ?? item.link,
    title,
    link: item.link ?? '',
    category: extractCategory(item.categories?.[0] ?? item.category),
    pubDate: item.pubDate ?? item.isoDate ?? null,
    description: stripHtml(item.contentEncoded ?? item.content ?? item.summary ?? ''),
    votes: isNaN(votes) ? 0 : votes,
    imageUrl,
    author: item.creator ?? item['dc:creator'] ?? 'Unknown',
    price,
    expiry,
    store: extractStore(title),
    delivery: extractDelivery(title),
    source: 'ozbargain',
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
