import fs from 'fs';
import { fetchDeals } from './fetcher.js';
import { filterDeals } from './filter.js';
import { loadSeenIds, saveSeenIds } from './store.js';
import { sendDealNotification, sleep } from './notifier.js';

const HEALTH_FILE = '/tmp/health';

function touchHealth() {
  try {
    fs.writeFileSync(HEALTH_FILE, String(Date.now()));
  } catch {
    // non-fatal
  }
}

// Delay between Discord posts to respect rate limits (30 req/min)
const INTER_POST_DELAY_MS = 2000;

/**
 * Runs a single poll cycle:
 *   fetch → filter → identify new deals → notify → persist
 *
 * @param {Object} config - App config
 * @returns {Promise<number>} Number of notifications sent
 */
export async function runOnce(config) {
  const deals = await fetchDeals();
  if (deals.length === 0) return 0;

  const filtered = filterDeals(deals, config);
  const seenIds = await loadSeenIds(config.dataDir);

  const newDeals = filtered.filter(deal => !seenIds.has(deal.id));

  if (newDeals.length > 0) {
    console.log(`[monitor] Found ${newDeals.length} new deal(s) — sending notifications...`);
  }

  let notified = 0;
  for (const deal of newDeals) {
    seenIds.add(deal.id);
    const ok = await sendDealNotification(deal, config);
    if (ok) {
      notified++;
      console.log(`[monitor] Notified: ${deal.title} [${deal.category}] (+${deal.votes})`);
    }
    if (newDeals.indexOf(deal) < newDeals.length - 1) {
      await sleep(INTER_POST_DELAY_MS);
    }
  }

  // Mark all (unfiltered) deals as seen so we don't re-evaluate them next cycle
  for (const deal of deals) {
    seenIds.add(deal.id);
  }

  await saveSeenIds(seenIds, config.dataDir, config.maxSeenDeals);
  touchHealth();
  return notified;
}

/**
 * Starts the polling loop.
 * On startup, posts the most recent deal so you know the bot is live,
 * then seeds everything else as seen before entering the regular poll loop.
 *
 * @param {Object} config - App config
 */
export async function startMonitor(config) {
  const deals = await fetchDeals();
  const filtered = filterDeals(deals, config);
  const seenIds = await loadSeenIds(config.dataDir);

  if (filtered.length > 0) {
    // Post the single most recent deal as a startup heartbeat
    const latest = filtered[0];
    console.log(`[monitor] Sending startup deal: ${latest.title}`);
    await sendDealNotification(latest, config);
  }

  // Seed all current deals as seen so the first real poll only catches new ones
  for (const deal of deals) {
    seenIds.add(deal.id);
  }
  await saveSeenIds(seenIds, config.dataDir, config.maxSeenDeals);
  touchHealth();

  console.log(`[monitor] Ready. Watching for new deals every ${config.pollIntervalMs / 1000}s...`);

  setInterval(async () => {
    try {
      await runOnce(config);
    } catch (err) {
      console.error(`[monitor] Unexpected error during poll: ${err.message}`);
    }
  }, config.pollIntervalMs);
}
