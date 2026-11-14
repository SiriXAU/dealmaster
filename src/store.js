import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { writeFileAtomic } from './fsUtil.js';

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
  const filePath = path.join(dataDir, 'seen-deals.json');

  // Each row stores a content hash and/or a fuzzy hash with a shared
  // timestamp. Pairing is purely a storage optimisation (the loader reads h and
  // f independently), so pair fuzzies with any content hash of the same
  // timestamp. Grouping by timestamp keeps this O(n).
  const fuzziesByTime = new Map();
  for (const [f, t] of fuzzies) {
    const list = fuzziesByTime.get(t) ?? [];
    list.push(f);
    fuzziesByTime.set(t, list);
  }

  const entries = [];
  for (const [h, t] of hashes) {
    const f = fuzziesByTime.get(t)?.pop() ?? null;
    entries.push({ h, t, f });
  }
  for (const [t, list] of fuzziesByTime) {
    for (const f of list) entries.push({ h: null, t, f });
  }

  if (entries.length > maxSize) {
    entries.sort((a, b) => b.t - a.t);
    entries.length = maxSize;
  }

  let idArr = Array.from(ids);
  if (idArr.length > maxSize) {
    idArr = idArr.slice(idArr.length - maxSize);
  }

  await writeFileAtomic(filePath, JSON.stringify({ ids: idArr, entries }));
}

// Re-export for backward compat
export { loadSeenDeals as loadSeenIds };
