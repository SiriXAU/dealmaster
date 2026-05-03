import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';
import { matchesCategories, meetsMinVotes, matchesKeywords } from './filter.js';
import { contentHash } from './store.js';

const log = createLogger('deallog');

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Loads the deal log from disk.
 * @param {string} dataDir
 * @returns {Promise<Array>}
 */
export async function loadDealLog(dataDir) {
  const filePath = path.join(dataDir, 'deal-log.json');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch {
    // File missing or corrupt — start fresh
  }
  return [];
}

/**
 * Persists the deal log to disk, pruning entries older than 24 hours.
 * @param {string} dataDir
 * @param {Array} deals
 */
async function saveDealLog(dataDir, deals) {
  const cutoff = Date.now() - MAX_AGE_MS;
  const pruned = deals.filter(d => new Date(d.fetchedAt).getTime() > cutoff);

  const filePath = path.join(dataDir, 'deal-log.json');
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(pruned), 'utf-8');
  } catch (err) {
    log.error(`Failed to save deal log: ${err.message}`);
  }
}

/**
 * Logs all deals from a poll cycle, annotating each with its filter/notify status.
 * Called once per poll cycle by monitor.js.
 *
 * @param {string} dataDir
 * @param {Array} allDeals       - All fetched deals
 * @param {Array} filteredDeals  - Deals that passed category/keyword/vote filters
 * @param {Set<string>} seenIds  - Previously seen deal IDs
 * @param {Map<string, number>} hashes - Content hash → seen timestamp
 * @param {Set<string>} notifiedIds - Deals where notification actually succeeded
 * @param {Object} config        - App config (categories, keywords, minVotes, gamingSources)
 */
export async function logDeals(dataDir, allDeals, filteredDeals, seenIds, hashes, notifiedIds, config) {
  const now = Date.now();
  const filteredSet = new Set(filteredDeals.map(d => d.id));
  const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

  const entries = allDeals.map(deal => {
    let filterReason = null;

    if (!filteredSet.has(deal.id)) {
      // Determine which filter caught it
      if (config.categories.length > 0 && !matchesCategories(deal, config.categories)) {
        filterReason = 'category mismatch';
      } else if (config.keywords.length > 0 && !matchesKeywords(deal, config.keywords)) {
        filterReason = 'keyword mismatch';
      } else if (!meetsMinVotes(deal, config.minVotes)) {
        filterReason = `below min votes: ${deal.votes} < ${config.minVotes}`;
      } else {
        filterReason = 'filtered';
      }
    } else if (seenIds.has(deal.id)) {
      filterReason = 'already seen';
    } else if (hashes.has(contentHash(deal))) {
      const seenAt = hashes.get(contentHash(deal));
      if (seenAt && (now - seenAt) < DEDUP_WINDOW_MS) {
        filterReason = 'content duplicate';
      }
    }

    const wasNotified = notifiedIds.has(deal.id);
    // If it passed all checks but notification failed, note that
    if (!filterReason && !wasNotified && !seenIds.has(deal.id)) {
      filterReason = 'notification failed';
    }

    return {
      id:          deal.id,
      title:       deal.title ?? 'Unknown Deal',
      link:        deal.link ?? '',
      category:    deal.category ?? '',
      price:       deal.price ?? null,
      store:       deal.store ?? null,
      source:      deal.source,
      votes:       deal.votes ?? 0,
      type:        deal.type ?? null,
      fetchedAt:   new Date().toISOString(),
      wasNotified,
      filterReason,
    };
  });

  // Merge with existing log, keeping only entries from the last 24h
  const existing = await loadDealLog(dataDir);
  const cutoff = now - MAX_AGE_MS;
  const recent = existing.filter(d => new Date(d.fetchedAt).getTime() > cutoff);

  // Prepend new entries (newest first)
  const merged = [...entries, ...recent];

  // Deduplicate by ID — keep the newest entry for each ID
  const seen = new Set();
  const deduped = merged.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  await saveDealLog(dataDir, deduped);
}
