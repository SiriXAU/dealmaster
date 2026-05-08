import fs from 'fs';
import { createLogger } from './logger.js';
import { fetchAllDeals } from './fetcher.js';
import { filterForProfile } from './filter.js';
import { loadSeenDeals, saveSeenDeals, contentHash, fuzzyHash } from './store.js';
import { sendDealNotification, sendDigest, sleep } from './notifier.js';
import { addToHistory } from './history.js';
import { logDeals } from './dealLog.js';
import { currentMode, nextDigestAt, quietWindowEnd } from './scheduler.js';
import { loadQueue, saveQueue, enqueue, drain, size as queueSize } from './digestQueue.js';

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
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

let _pollTimer = null;
let _digestTimers = new Map(); // profileId → timeout handle
let _activeQueue = null;        // Map<profileId, Array<{deal, queuedAt}>>
let _activeConfig = null;       // last config we polled with
let _lastMode = new Map();      // profileId → 'realtime'|'digest'|'quiet' (previous cycle)

export function stopPollLoop() {
  if (_pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  for (const t of _digestTimers.values()) clearTimeout(t);
  _digestTimers.clear();
}

export function startPollLoop(config) {
  stopPollLoop();
  _activeConfig = config;
  _pollTimer = setInterval(async () => {
    try {
      await runOnce(config);
    } catch (err) {
      log.error(`Unexpected error during poll: ${err.message}`);
    }
  }, config.pollIntervalMs);
  log.info(`Poll loop started (interval: ${config.pollIntervalMs / 1000}s)`);
  rescheduleDigestTimers(config);
}

/**
 * Persists the current pending-digest queue. Used on graceful shutdown.
 */
export async function persistPendingDigest() {
  if (_activeQueue && _activeConfig) {
    try {
      await saveQueue(_activeConfig.dataDir, _activeQueue);
      log.info('Persisted pending-digest queue.');
    } catch (err) {
      log.error(`Failed to persist pending-digest queue: ${err.message}`);
    }
  }
}

async function ensureQueue(config) {
  if (_activeQueue) return _activeQueue;
  _activeQueue = await loadQueue(config.dataDir);
  return _activeQueue;
}

function rescheduleDigestTimers(config) {
  for (const t of _digestTimers.values()) clearTimeout(t);
  _digestTimers.clear();
  if (!Array.isArray(config?.profiles)) return;

  const now = Date.now();
  for (const profile of config.profiles) {
    const mode = currentMode(profile, now);
    let target = null;

    if (mode === 'quiet') {
      target = quietWindowEnd(profile, now);
    } else if (profile?.schedule?.mode === 'digest') {
      target = nextDigestAt(profile, now);
    }

    if (target == null) continue;

    const delay = Math.max(0, target - now);
    const handle = setTimeout(async () => {
      try {
        await flushProfileDigest(profile.id, config);
      } catch (err) {
        log.error(`Digest flush failed for "${profile.id}": ${err.message}`);
      }
      // Re-arm for the next boundary.
      rescheduleDigestTimers(_activeConfig ?? config);
    }, delay);
    _digestTimers.set(profile.id, handle);
  }
}

async function flushProfileDigest(profileId, config) {
  const queue = await ensureQueue(config);
  const profile = config.profiles.find(p => p.id === profileId);
  if (!profile) return;
  const drained = drain(queue, profileId);
  if (drained.length === 0) return;
  log.info(`Flushing digest for "${profileId}" — ${drained.length} deal(s)`);
  const { ok } = await sendDigest(drained, profile.appriseUrls, profile.name);
  if (ok) {
    for (const d of drained) {
      await addToHistory(config.dataDir, d).catch(() => {});
    }
  } else {
    log.warn(`Digest delivery failed for "${profileId}" — re-queueing ${drained.length} deal(s)`);
    for (const d of drained) enqueue(queue, profileId, d);
  }
  await saveQueue(config.dataDir, queue);
}

function evaluateProfile(profile, deals) {
  return filterForProfile(deals, profile);
}

/**
 * Runs a single poll cycle: fetch → per-profile filter/dispatch → persist.
 * @returns {Promise<number>} total realtime notifications sent
 */
export async function runOnce(config) {
  _activeConfig = config;
  const fetched = await fetchAllDeals(config);
  if (fetched.length === 0) return 0;

  const queue = await ensureQueue(config);
  const { ids: seenIds, hashes, fuzzies } = await loadSeenDeals(config.dataDir);
  const seenIdsBefore = new Set(seenIds);
  const now = Date.now();

  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  const profileMatches = new Map(); // dealId → string[] of profile ids
  const filteredAny = new Set();    // dealId, deal that any profile accepted
  const notifiedIds = new Set();
  const queuedIds   = new Set();

  // Step 1: per-profile filter; collect realtime sends and digest enqueues.
  // Order matters slightly — we evaluate profiles in array order, but matches
  // for a deal go to ALL matching profiles regardless of dedup.
  const realtimeSends = []; // [{ deal, urls, profile }]

  for (const profile of profiles) {
    const candidates = evaluateProfile(profile, fetched);
    const newOnes = candidates.filter(deal => {
      if (seenIdsBefore.has(deal.id)) return false;
      const ch = contentHash(deal);
      const seenH = hashes.get(ch);
      if (seenH && (now - seenH) < DEDUP_WINDOW_MS) return false;
      const fh = fuzzyHash(deal);
      const seenF = fuzzies.get(fh);
      if (seenF && (now - seenF) < DEDUP_WINDOW_MS) return false;
      return true;
    });

    const mode = currentMode(profile, now);
    for (const deal of newOnes) {
      filteredAny.add(deal.id);
      const list = profileMatches.get(deal.id) ?? [];
      list.push(profile.id);
      profileMatches.set(deal.id, list);

      if (mode === 'realtime') {
        realtimeSends.push({ deal, urls: profile.appriseUrls, profile });
      } else {
        enqueue(queue, profile.id, deal, now);
        queuedIds.add(deal.id);
      }
    }
  }

  // Also annotate deals that passed any profile filter but were skipped due to
  // seen/dedup, so the deal log can show a meaningful reason.
  for (const profile of profiles) {
    for (const deal of evaluateProfile(profile, fetched)) {
      filteredAny.add(deal.id);
    }
  }

  // Step 2: realtime delivery, sequential with inter-post delay.
  let notified = 0;
  for (let i = 0; i < realtimeSends.length; i++) {
    const { deal, urls, profile } = realtimeSends[i];
    const { ok } = await sendDealNotification(deal, urls);
    if (ok) {
      notified++;
      notifiedIds.add(deal.id);
      await addToHistory(config.dataDir, deal);
      log.info(`Notified [${profile.id}]: ${deal.title} [${deal.category}] (+${deal.votes})`);
    }
    if (i < realtimeSends.length - 1) {
      await sleep(INTER_POST_DELAY_MS);
    }
  }

  // Step 3: handle "quiet → realtime" flush. If a profile was non-realtime last
  // cycle but is realtime now, drain its queue immediately as one digest.
  for (const profile of profiles) {
    const prev = _lastMode.get(profile.id);
    const curr = currentMode(profile, now);
    if (prev && prev !== 'realtime' && curr === 'realtime' && queueSize(queue, profile.id) > 0) {
      try {
        await flushProfileDigest(profile.id, config);
      } catch (err) {
        log.error(`Auto-flush on quiet-end failed for "${profile.id}": ${err.message}`);
      }
    }
    _lastMode.set(profile.id, curr);
  }

  // Step 4: mark all fetched deals seen (so we don't re-evaluate forever).
  for (const deal of fetched) {
    seenIds.add(deal.id);
    hashes.set(contentHash(deal), now);
    fuzzies.set(fuzzyHash(deal), now);
  }

  // Step 5: persist.
  await saveSeenDeals(seenIds, hashes, fuzzies, config.dataDir, config.maxSeenDeals);
  await saveQueue(config.dataDir, queue);

  // Build the "filtered" array for the deal log: every deal that any profile accepted.
  const filteredArr = fetched.filter(d => filteredAny.has(d.id));
  await logDeals(
    config.dataDir,
    fetched,
    filteredArr,
    seenIdsBefore,
    hashes,
    fuzzies,
    notifiedIds,
    profileMatches,
    queuedIds,
    config,
  );
  touchHealth();

  // Re-arm digest timers in case schedules shifted across the poll boundary.
  rescheduleDigestTimers(config);

  return notified;
}

/**
 * On startup, sends the most recent matching deal for the first profile (so
 * the user sees the bot is live), then seeds everything else as seen.
 */
export async function startMonitor(config) {
  _activeConfig = config;
  const fetched = await fetchAllDeals(config);
  const queue = await ensureQueue(config);
  const { ids: seenIds, hashes, fuzzies } = await loadSeenDeals(config.dataDir);

  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  if (profiles.length > 0 && fetched.length > 0) {
    const head = profiles[0];
    const matches = filterForProfile(fetched, head);
    if (matches.length > 0) {
      const latest = matches[0];
      log.info(`Sending startup deal: ${latest.title} [profile=${head.id}]`);
      await sendDealNotification(latest, head.appriseUrls);
    }
  }

  const now = Date.now();
  for (const deal of fetched) {
    seenIds.add(deal.id);
    hashes.set(contentHash(deal), now);
    fuzzies.set(fuzzyHash(deal), now);
  }
  await saveSeenDeals(seenIds, hashes, fuzzies, config.dataDir, config.maxSeenDeals);
  touchHealth();

  // Initialise last-mode map.
  for (const p of profiles) _lastMode.set(p.id, currentMode(p, now));

  log.info(`Ready. Watching for new deals every ${config.pollIntervalMs / 1000}s...`);

  startPollLoop(config);
}
