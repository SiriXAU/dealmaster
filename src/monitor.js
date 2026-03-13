import { fetchDeals } from './fetcher.js';
import { filterDeals } from './filter.js';
import { loadSeenIds, saveSeenIds } from './store.js';
import { sendDealNotification, sleep } from './notifier.js';

// Delay between Discord posts to respect rate limits (30 req/min)
const INTER_POST_DELAY_MS = 2000;

/**
 * Runs a single poll cycle:
 *   fetch → filter → identify new deals → notify → persist
 *
 * @param {Object} config - App config
 * @param {boolean} silent - If true, mark deals as seen without notifying (first-run seeding)
 * @returns {Promise<number>} Number of notifications sent
 */
export async function runOnce(config, silent = false) {
  const deals = await fetchDeals();
  if (deals.length === 0) return 0;

  const filtered = filterDeals(deals, config);
  const seenIds = await loadSeenIds(config.dataDir);

  const newDeals = filtered.filter(deal => !seenIds.has(deal.id));

  if (newDeals.length > 0) {
    if (silent) {
      console.log(`[monitor] Seeding ${newDeals.length} existing deal(s) as seen (no notifications sent).`);
    } else {
      console.log(`[monitor] Found ${newDeals.length} new deal(s) — sending notifications...`);
    }
  }

  let notified = 0;
  for (const deal of newDeals) {
    seenIds.add(deal.id);

    if (!silent) {
      const ok = await sendDealNotification(deal, config);
      if (ok) {
        notified++;
        console.log(`[monitor] Notified: ${deal.title} [${deal.category}] (+${deal.votes})`);
      }
      // Brief delay between posts
      if (newDeals.indexOf(deal) < newDeals.length - 1) {
        await sleep(INTER_POST_DELAY_MS);
      }
    }
  }

  // Also add all (unfiltered) seen IDs so we don't re-evaluate them next cycle
  for (const deal of deals) {
    seenIds.add(deal.id);
  }

  await saveSeenIds(seenIds, config.dataDir, config.maxSeenDeals);
  return notified;
}

/**
 * Starts the polling loop.
 * The first run silently seeds seen IDs to avoid notification spam on startup.
 *
 * @param {Object} config - App config
 */
export async function startMonitor(config) {
  // First run: seed without notifying
  await runOnce(config, true);
  console.log(`[monitor] Initial seed complete. Watching for new deals every ${config.pollIntervalMs / 1000}s...`);

  // Subsequent runs: notify on new deals
  setInterval(async () => {
    try {
      await runOnce(config, false);
    } catch (err) {
      console.error(`[monitor] Unexpected error during poll: ${err.message}`);
    }
  }, config.pollIntervalMs);
}
