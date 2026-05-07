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
 * Generates a fuzzy hash for cross-source deduplication.
 * Strips punctuation, collapses whitespace, lowercases, and uses only the
 * first 64 chars of the title plus the price. The same deal cross-posted
 * from OzBargain and GamerPower will collide here even when GUID/link differ.
 */
export function fuzzyHash(deal) {
  const norm = (deal.title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  const price = (deal.price ?? '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  const key = `${norm}|${price}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Loads previously seen deal IDs, content hashes, and fuzzy hashes.
 * Tolerates the legacy flat-array shape and the {ids, entries:[{h,t}]} shape.
 *
 * @param {string} dataDir
 * @returns {Promise<{ ids: Set<string>, hashes: Map<string, number>, fuzzies: Map<string, number> }>}
 */
export async function loadSeenDeals(dataDir) {
  const filePath = path.join(dataDir, 'seen-deals.json');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return { ids: new Set(data), hashes: new Map(), fuzzies: new Map() };
    }
    if (data && Array.isArray(data.ids)) {
      const ids = new Set(data.ids);
      const hashes = new Map();
      const fuzzies = new Map();
      if (Array.isArray(data.entries)) {
        for (const e of data.entries) {
          if (e.h && e.t) hashes.set(e.h, e.t);
          if (e.f && e.t) fuzzies.set(e.f, e.t);
        }
      }
      return { ids, hashes, fuzzies };
    }
  } catch {
    // File missing or corrupt — start fresh
  }
  return { ids: new Set(), hashes: new Map(), fuzzies: new Map() };
}

/**
 * Persists seen deal IDs, content hashes, and fuzzy hashes.
 * Trims the oldest hash entries when the total exceeds maxSize.
 */
export async function saveSeenDeals(ids, hashes, fuzzies, dataDir, maxSize) {
  await fs.mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, 'seen-deals.json');

  // Build entries keyed by content hash; merge fuzzy hashes by timestamp match.
  const byHash = new Map();
  for (const [h, t] of hashes) {
    byHash.set(h, { h, t, f: null });
  }
  // Pair each fuzzy hash with the entry that shares its timestamp (best-effort);
  // otherwise emit it as its own row keyed only on f.
  for (const [f, t] of fuzzies) {
    let paired = false;
    for (const entry of byHash.values()) {
      if (entry.t === t && entry.f === null) {
        entry.f = f;
        paired = true;
        break;
      }
    }
    if (!paired) byHash.set(`f:${f}`, { h: null, t, f });
  }

  let entries = Array.from(byHash.values());
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
