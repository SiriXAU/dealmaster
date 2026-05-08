import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';
import { matchesCategories, meetsMinVotes, matchesKeywords } from './filter.js';
import { contentHash, fuzzyHash } from './store.js';

const log = createLogger('deallog');

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Loads the deal log from disk.
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
 * Logs all deals from a poll cycle, annotating each with filter/notify/queue status
 * and recording which profiles matched.
 *
 * @param {string} dataDir
 * @param {Array} allDeals       - All fetched deals
 * @param {Array} filteredDeals  - Deals that passed at least one profile's filters
 * @param {Set<string>} seenIds  - Previously seen deal IDs (before this cycle)
 * @param {Map<string, number>} hashes - Content hash → seen timestamp
 * @param {Map<string, number>} fuzzies - Fuzzy hash → seen timestamp
 * @param {Set<string>} notifiedIds - Deals where realtime notification fired
 * @param {Map<string, string[]>} profileMatches - dealId → list of profile ids that matched
 * @param {Set<string>} queuedIds - Deals enqueued for digest delivery
 * @param {Object} config        - App config (profiles[], gamingSources)
 */
export async function logDeals(dataDir, allDeals, filteredDeals, seenIds, hashes, fuzzies, notifiedIds, profileMatches, queuedIds, config) {
  const now = Date.now();
  const filteredSet = new Set(filteredDeals.map(d => d.id));
  const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

  const existing = await loadDealLog(dataDir);
  const cutoff = now - MAX_AGE_MS;
  const recent = existing.filter(d => new Date(d.fetchedAt).getTime() > cutoff);
  const existingMap = new Map(recent.map(e => [e.id, e]));

  // Build a "any profile" view of categories/keywords/minVotes for the
  // human-readable filterReason. Use the union for category/keyword and the
  // lowest minVotes across profiles so we don't lie about "category mismatch"
  // when one profile would have accepted it.
  const profiles = Array.isArray(config?.profiles) ? config.profiles : [];
  const allCategories = profiles.flatMap(p => p.categories ?? []);
  const allKeywords   = profiles.flatMap(p => p.keywords ?? []);
  const minMinVotes   = profiles.length > 0 ? Math.min(...profiles.map(p => p.minVotes ?? 0)) : 0;

  const entries = allDeals.map(deal => {
    let filterReason = null;
    const matched = profileMatches.get(deal.id) ?? [];

    if (!filteredSet.has(deal.id)) {
      if (allCategories.length > 0 && !matchesCategories(deal, allCategories)) {
        filterReason = 'category mismatch';
      } else if (allKeywords.length > 0 && !matchesKeywords(deal, allKeywords)) {
        filterReason = 'keyword mismatch';
      } else if (!meetsMinVotes(deal, minMinVotes)) {
        filterReason = `below min votes: ${deal.votes} < ${minMinVotes}`;
      } else {
        filterReason = 'filtered';
      }
    } else if (seenIds.has(deal.id)) {
      filterReason = 'already seen';
    } else {
      const ch = contentHash(deal);
      const fh = fuzzyHash(deal);
      const hashSeenAt  = hashes.get(ch);
      const fuzzySeenAt = fuzzies.get(fh);
      if (hashSeenAt && (now - hashSeenAt) < DEDUP_WINDOW_MS) {
        filterReason = 'content duplicate';
      } else if (fuzzySeenAt && (now - fuzzySeenAt) < DEDUP_WINDOW_MS) {
        filterReason = 'cross-source duplicate';
      }
    }

    const wasNotified = notifiedIds.has(deal.id);
    const wasQueued   = queuedIds.has(deal.id);

    if (!filterReason && !wasNotified && !wasQueued && !seenIds.has(deal.id)) {
      filterReason = 'notification failed';
    }

    const fetchedAt = existingMap.get(deal.id)?.fetchedAt ?? deal.pubDate ?? new Date().toISOString();

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
      fetchedAt,
      wasNotified,
      wasQueued,
      profiles:    matched,
      filterReason,
    };
  });

  const merged = [...entries, ...recent];

  const seen = new Set();
  const deduped = merged.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  await saveDealLog(dataDir, deduped);
}
