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
 * Normalizes a raw RSS item into a consistent deal shape.
 */
function normalizeItem(item) {
  const meta = item.ozbMeta ?? {};
  const votes = parseInt(meta['$']?.votes ?? meta.votes ?? '0', 10);
  const imageUrl = meta['$']?.image ?? meta.image ?? null;

  return {
    id: item.guid ?? item.link,
    title: item.title ?? 'Unknown Deal',
    link: item.link ?? '',
    category: extractCategory(item.categories?.[0] ?? item.category),
    pubDate: item.pubDate ?? item.isoDate ?? null,
    description: stripHtml(item.contentEncoded ?? item.content ?? item.summary ?? ''),
    votes: isNaN(votes) ? 0 : votes,
    imageUrl,
    author: item.creator ?? item['dc:creator'] ?? 'Unknown',
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
