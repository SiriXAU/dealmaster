import Parser from 'rss-parser';

const FEED_URL = 'https://www.reddit.com/r/AussieFrugal/new.rss';
const USER_AGENT = 'Mozilla/5.0 (compatible; dealmaster/1.0; +https://github.com/SiriXAU/dealmaster)';

const parser = new Parser({
  requestOptions: {
    headers: {
      'User-Agent': USER_AGENT,
    },
  },
});

/**
 * Fetches and parses the r/AussieFrugal Reddit RSS feed.
 * @returns {Promise<Array>} Array of normalized deal objects, or [] on error.
 */
export async function fetchRedditDeals() {
  try {
    const feed = await parser.parseURL(FEED_URL);
    return feed.items.map(normalizeItem);
  } catch (err) {
    console.error(`[reddit-fetcher] Failed to fetch feed: ${err.message}`);
    return [];
  }
}

/**
 * Normalizes a raw Reddit Atom item into a consistent deal shape.
 */
function normalizeItem(item) {
  return {
    id: item.guid ?? item.link,
    title: item.title ?? 'Unknown Deal',
    link: item.link ?? '',
    category: item.categories?.[0] ?? 'Uncategorised',
    pubDate: item.isoDate ?? item.pubDate ?? null,
    description: stripHtml(item.content ?? item.summary ?? ''),
    votes: 0,        // Reddit RSS does not expose vote counts
    imageUrl: null,  // Reddit RSS does not include post images
    author: item.author ?? item.creator ?? 'Unknown',
    source: 'reddit',
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
