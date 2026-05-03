import fs from 'fs';
import { createLogger } from './logger.js';
import { fetchAllDeals } from './fetcher.js';
import { filterDeals } from './filter.js';
import { loadSeenDeals, saveSeenDeals, contentHash } from './store.js';
import { sendDealNotification, sleep } from './notifier.js';
import { addToHistory } from './history.js';

const log = createLogger('monitor');

const HEALTH_FILE = '/tmp/health';

let lastSuccessfulPoll = 0;

export function getLastPollTime() {
  return lastSuccessfulPoll;
}

function touchHealth() {
  lastSuccessfulPoll = Date.now();
  try {
    fs.writeFileSync(HEALTH_FILE, String(lastSuccessfulPoll));
  } catch {
    // non-fatal
  }
}

const INTER_POST_DELAY_MS = 2000;

let _pollTimer = null;

export function stopPollLoop() {
  if (_pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

export function startPollLoop(config) {
  stopPollLoop();
  _pollTimer = setInterval(async () => {
    try {
      await runOnce(config);
    } catch (err) {
      log.error(`Unexpected error during poll: ${err.message}`);
    }
  }, config.pollIntervalMs);
  log.info(`Poll loop started (interval: ${config.pollIntervalMs / 1000}s)`);
}

/**
 * Runs a single poll cycle:
 *   fetch → filter → identify new deals → notify → persist
 *
 * @param {Object} config - App config
 * @returns {Promise<number>} Number of notifications sent
 */
export async function runOnce(config) {
  const deals = await fetchAllDeals(config);
  if (deals.length === 0) return 0;

  const filtered = filterDeals(deals, config);
  const { ids: seenIds, hashes } = await loadSeenDeals(config.dataDir);

  const now = Date.now();
  const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

  const newDeals = filtered.filter(deal => {
    if (seenIds.has(deal.id)) return false;
    const hash = contentHash(deal);
    const seenAt = hashes.get(hash);
    if (seenAt && (now - seenAt) < DEDUP_WINDOW_MS) return false;
    return true;
  });

  if (newDeals.length > 0) {
    log.info(`Found ${newDeals.length} new deal(s) — sending notifications...`);
  }

  let notified = 0;
  for (const deal of newDeals) {
    seenIds.add(deal.id);
    const { ok } = await sendDealNotification(deal, config);
    if (ok) {
      notified++;
      await addToHistory(config.dataDir, deal);
      log.info(`Notified: ${deal.title} [${deal.category}] (+${deal.votes})`);
    }
    if (newDeals.indexOf(deal) < newDeals.length - 1) {
      await sleep(INTER_POST_DELAY_MS);
    }
  }

  // Mark all deals (including filtered) as seen, and record content hashes
  for (const deal of deals) {
    seenIds.add(deal.id);
    hashes.set(contentHash(deal), now);
  }

  await saveSeenDeals(seenIds, hashes, config.dataDir, config.maxSeenDeals);
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
  const deals = await fetchAllDeals(config);
  const filtered = filterDeals(deals, config);
  const { ids: seenIds, hashes } = await loadSeenDeals(config.dataDir);

  if (filtered.length > 0) {
    const latest = filtered[0];
    log.info(`Sending startup deal: ${latest.title}`);
    await sendDealNotification(latest, config);
  }

  // Seed all current deals as seen so the first real poll only catches new ones
  const now = Date.now();
  for (const deal of deals) {
    seenIds.add(deal.id);
    hashes.set(contentHash(deal), now);
  }
  await saveSeenDeals(seenIds, hashes, config.dataDir, config.maxSeenDeals);
  touchHealth();

  log.info(`Ready. Watching for new deals every ${config.pollIntervalMs / 1000}s...`);

  startPollLoop(config);
}
