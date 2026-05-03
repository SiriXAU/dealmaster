import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * Generates a content hash for deduplication.
 * Uses title + link + price to catch reposted deals with different GUIDs.
 */
export function contentHash(deal) {
  const key = `${deal.title ?? ''}|${deal.link ?? ''}|${deal.price ?? ''}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Loads the set of previously seen deal IDs and a Map of content hash → seen timestamp.
 * Backward-compatible with the old flat-array seen-deals.json format.
 *
 * @param {string} dataDir
 * @returns {Promise<{ ids: Set<string>, hashes: Map<string, number> }>}
 */
export async function loadSeenDeals(dataDir) {
  const filePath = path.join(dataDir, 'seen-deals.json');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      // Old format: plain array of ID strings — no content hashes
      return { ids: new Set(data), hashes: new Map() };
    }
    if (data && Array.isArray(data.ids)) {
      const ids = new Set(data.ids);
      const hashes = new Map();
      if (Array.isArray(data.entries)) {
        for (const e of data.entries) {
          if (e.h && e.t) hashes.set(e.h, e.t);
        }
      }
      return { ids, hashes };
    }
  } catch {
    // File missing or corrupt — start fresh
  }
  return { ids: new Set(), hashes: new Map() };
}

/**
 * Persists seen deal IDs and content hashes to disk.
 * Trims the oldest entries if total exceeds maxSize.
 *
 * @param {Set<string>} ids
 * @param {Map<string, number>} hashes - content hash → seen timestamp
 * @param {string} dataDir
 * @param {number} maxSize
 */
export async function saveSeenDeals(ids, hashes, dataDir, maxSize) {
  await fs.mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, 'seen-deals.json');

  const entries = [];
  for (const [h, t] of hashes) {
    entries.push({ h, t });
  }
  // Keep most recent entries
  if (entries.length > maxSize) {
    entries.sort((a, b) => b.t - a.t);
    entries.length = maxSize;
  }

  let idArr = Array.from(ids);
  if (idArr.length > maxSize) {
    idArr = idArr.slice(idArr.length - maxSize);
  }

  await fs.writeFile(filePath, JSON.stringify({ ids: idArr, entries }), 'utf-8');
}

// Re-export for backward compat
export { loadSeenDeals as loadSeenIds };
