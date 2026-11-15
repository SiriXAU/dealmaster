import fs from 'fs';
import { createLogger } from './logger.js';
import { fetchAllDeals } from './fetcher.js';
import { filterForProfile } from './filter.js';
import { loadSeenDeals, saveSeenDeals, contentHash, fuzzyHash } from './store.js';
import { sendDealNotification, sendDigest, sleep } from './notifier.js';
import { addToHistory } from './history.js';
import { logDeals } from './dealLog.js';
import { currentMode, scheduledMode, nextDigestAt, quietWindowEnd, isDigestDeferred } from './scheduler.js';
import { loadQueue, saveQueue, enqueue, drain, size as queueSize } from './digestQueue.js';

const log = createLogger('monitor');

const INTER_POST_DELAY_MS = 2000;
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Total delivery attempts (first try + retries on later polls) for a realtime deal. */
export const MAX_SEND_ATTEMPTS = 3;

// Side-effecting dependencies, swappable in tests.
const defaultDeps = { fetchAllDeals, sendDealNotification, sendDigest, sleep };
let deps = { ...defaultDeps };

let lastSuccessfulPoll = 0;

let _pollTimer = null;
let _pollGeneration = 0;        // bumped on every start/stop so stale loops exit
let _lock = Promise.resolve();  // serialises polls and digest flushes
let _digestTimers = new Map();  // profileId → timeout handle
let _activeQueue = null;        // Map<profileId, Array<{deal, queuedAt}>>
let _activeConfig = null;       // last config we polled with
let _lastMode = new Map();      // profileId → 'realtime'|'digest'|'quiet' (previous cycle)
let _seededSources = new Set(); // sources whose current feed contents are already marked seen
let _retries = new Map();       // profileId → Array<{ deal, attempts, urls, deliveredBefore }>

export function getLastPollTime() {
  return lastSuccessfulPoll;
}

const DEFAULT_HEALTH_FILE = '/tmp/health';

/**
 * Records a successful poll: updates the timestamp behind GET /health, and
 * rewrites the health file (default /tmp/health, override with HEALTH_FILE).
 * Deployments with a file-based container healthcheck read that file's mtime,
 * so it must keep being written.
 */
function touchHealth() {
  lastSuccessfulPoll = Date.now();
  const file = process.env.HEALTH_FILE || DEFAULT_HEALTH_FILE;
  try {
    fs.writeFileSync(file, String(lastSuccessfulPoll));
  } catch (err) {
    log.warn(`Could not update health file ${file}: ${err.message}`);
  }
}

/**
 * Runs `fn` after any in-flight poll/flush has finished, so two cycles never
 * read and write seen-deals.json or the digest queue at the same time.
 */
function withLock(fn) {
  const run = _lock.then(fn, fn);
  _lock = run.catch(() => {});
  return run;
}

export function stopPollLoop() {
  _pollGeneration++;
  if (_pollTimer !== null) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
  for (const t of _digestTimers.values()) clearTimeout(t);
  _digestTimers.clear();
}

/**
 * Starts (or restarts) the poll loop. The next poll is only scheduled once the
 * current one has finished, so a slow cycle can never overlap the next one.
 */
export function startPollLoop(config) {
  stopPollLoop();
  _activeConfig = config;
  const generation = _pollGeneration;

  const tick = async () => {
    if (generation !== _pollGeneration) return;
    try {
      await withLock(() => runOnceUnlocked(config));
    } catch (err) {
      log.error(`Unexpected error during poll: ${err.message}`);
    }
    if (generation === _pollGeneration) {
      _pollTimer = setTimeout(tick, config.pollIntervalMs);
    }
  };

  _pollTimer = setTimeout(tick, config.pollIntervalMs);
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

/**
 * When the next flush for this profile should happen, or null if none.
 *  - digest profiles flush at digestAt; if digestAt fell inside quiet hours
 *    the digest is held and sent when the quiet window ends instead.
 *  - realtime/quiet profiles inside quiet hours flush when the window ends.
 */
export function nextFlushTarget(profile, now) {
  const quiet = currentMode(profile, now) === 'quiet';
  if (scheduledMode(profile) === 'digest') {
    const digestAt = nextDigestAt(profile, now);
    if (quiet && isDigestDeferred(profile, now)) {
      const quietEnd = quietWindowEnd(profile, now);
      if (quietEnd != null && (digestAt == null || quietEnd < digestAt)) return quietEnd;
    }
    return digestAt;
  }
  return quiet ? quietWindowEnd(profile, now) : null;
}

function rescheduleDigestTimers(config) {
  for (const t of _digestTimers.values()) clearTimeout(t);
  _digestTimers.clear();
  if (!Array.isArray(config?.profiles)) return;

  const generation = _pollGeneration;
  const now = Date.now();
  for (const profile of config.profiles) {
    const target = nextFlushTarget(profile, now);
    if (target == null) continue;

    const handle = setTimeout(() => {
      if (generation !== _pollGeneration) return;
      withLock(async () => {
        const cfg = _activeConfig ?? config;
        const current = cfg.profiles?.find(p => p.id === profile.id);
        if (!current) return;
        const firedAt = Date.now();
        if (scheduledMode(current) === 'digest' && currentMode(current, firedAt) === 'quiet') {
          // digestAt landed inside quiet hours — hold it; nextFlushTarget
          // will now point at the end of the quiet window.
          return;
        }
        await flushProfileDigest(current.id, cfg);
      })
        .catch(err => log.error(`Digest flush failed for "${profile.id}": ${err.message}`))
        .finally(() => {
          if (generation === _pollGeneration) rescheduleDigestTimers(_activeConfig ?? config);
        });
    }, Math.max(0, target - now));
    _digestTimers.set(profile.id, handle);
  }
}

/** Sends a profile's queued deals as one digest. Caller must hold the lock. */
async function flushProfileDigest(profileId, config) {
  const queue = await ensureQueue(config);
  const profile = config.profiles.find(p => p.id === profileId);
  if (!profile) return;
  const drained = drain(queue, profileId);
  if (drained.length === 0) return;
  log.info(`Flushing digest for "${profileId}" — ${drained.length} deal(s)`);
  const { ok } = await deps.sendDigest(drained, profile.appriseUrls, profile.name);
  if (ok) {
    await addToHistory(config.dataDir, drained);
  } else {
    log.warn(`Digest delivery failed for "${profileId}" — re-queueing ${drained.length} deal(s)`);
    for (const d of drained) enqueue(queue, profileId, d);
  }
  await saveQueue(config.dataDir, queue);
}

/**
 * Removes duplicates within a list of deals: the same id (e.g. GamerPower "all"
 * and "games" both returning a giveaway), the same content, or the same deal
 * cross-posted on two sources. The first occurrence wins, so OzBargain (fetched
 * first) is preferred over gaming sources.
 *
 * Apply it to a profile's *filtered* matches, not the raw fetch: otherwise a
 * copy the profile rejects (e.g. an OzBargain post below minVotes) would
 * suppress a copy it accepts (the same giveaway on GamerPower).
 */
export function dedupeBatch(deals) {
  const ids = new Set();
  const hashes = new Set();
  const fuzzies = new Set();
  const out = [];
  for (const deal of deals) {
    const ch = contentHash(deal);
    const fh = fuzzyHash(deal);
    if (ids.has(deal.id) || hashes.has(ch) || fuzzies.has(fh)) continue;
    ids.add(deal.id);
    hashes.add(ch);
    fuzzies.add(fh);
    out.push(deal);
  }
  return out;
}

/** Queues a retry of `deal` to just the destinations (`urls`) that failed. */
function addRetry(profileId, deal, attempts, urls, deliveredBefore) {
  if (attempts >= MAX_SEND_ATTEMPTS) {
    log.error(`Giving up on "${deal.title}" for profile "${profileId}" (${urls.length} destination(s)) after ${attempts} failed attempt(s)`);
    return;
  }
  const list = _retries.get(profileId) ?? [];
  list.push({ deal, attempts, urls, deliveredBefore });
  _retries.set(profileId, list);
}

/**
 * Returns the configured URLs whose delivery failed. Falls back to every URL
 * that was attempted when the notifier gave no per-target results.
 */
function failedTargets(attempted, result) {
  if (!result) return attempted;
  if (!Array.isArray(result.results) || result.results.length === 0) {
    return result.ok ? [] : attempted;
  }
  const failed = new Set(result.results.filter(r => !r.ok).map(r => r.target ?? r.url));
  return attempted.filter(u => failed.has(u));
}

/**
 * Runs a single poll cycle: fetch → per-profile filter/dispatch → persist.
 * Waits for any in-flight cycle or digest flush to finish first.
 * @returns {Promise<number>} total realtime notifications sent
 */
export function runOnce(config) {
  return withLock(() => runOnceUnlocked(config));
}

async function runOnceUnlocked(config) {
  _activeConfig = config;
  const raw = await deps.fetchAllDeals(config);
  const queue = await ensureQueue(config);
  const now = Date.now();
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  const profileById = new Map(profiles.map(p => [p.id, p]));

  const { ids: seenIds, hashes, fuzzies } = await loadSeenDeals(config.dataDir);
  const seenIdsBefore = new Set(seenIds);
  const hashesBefore  = new Map(hashes);
  const fuzziesBefore = new Map(fuzzies);

  // Sources that weren't seeded at startup (fetch failed then, or the source
  // was enabled later) have their current contents marked seen without
  // notifying — otherwise their whole feed would arrive as a flood.
  // One entry per id for logging/seeding; content-level dedup happens per
  // profile after filtering (see dedupeBatch).
  const byId = new Map();
  for (const deal of raw) if (!byId.has(deal.id)) byId.set(deal.id, deal);
  const fetched = [...byId.values()];
  const newSources = [...new Set(fetched.map(d => d.source))].filter(s => !_seededSources.has(s));
  for (const source of newSources) {
    const n = fetched.filter(d => d.source === source).length;
    log.info(`Seeding ${n} existing deal(s) from "${source}" without notifying`);
  }
  const candidates = fetched.filter(d => _seededSources.has(d.source));

  const profileMatches = new Map(); // dealId → string[] of profile ids
  const filteredAny = new Set();    // dealId of any deal some profile accepted
  const notifiedIds = new Set();
  const queuedIds   = new Set();
  const realtimeSends = []; // [{ deal, profile, attempts }]

  // Step 1: retry earlier failed realtime sends (or queue them if the profile
  // is no longer realtime). Retries for deleted profiles are dropped.
  const pendingRetries = _retries;
  _retries = new Map();
  for (const [profileId, list] of pendingRetries) {
    const profile = profileById.get(profileId);
    if (!profile) continue;
    for (const { deal, attempts, urls, deliveredBefore } of list) {
      // Only retry destinations that are still configured on the profile.
      const stillConfigured = (urls ?? profile.appriseUrls).filter(u => profile.appriseUrls.includes(u));
      if (stillConfigured.length === 0) continue;
      if (currentMode(profile, now) === 'realtime') {
        realtimeSends.push({ deal, profile, attempts, urls: stillConfigured, deliveredBefore });
      } else {
        // The profile has gone quiet/digest. Its digest goes to every URL, so
        // this re-delivers to destinations that already got the realtime post;
        // a missed deal is worse than a repeat inside a digest.
        enqueue(queue, profile.id, deal, now);
      }
    }
  }

  // Step 2: per-profile filter; collect realtime sends and digest enqueues.
  for (const profile of profiles) {
    const matches = dedupeBatch(filterForProfile(candidates, profile));
    const mode = currentMode(profile, now);
    for (const deal of matches) {
      filteredAny.add(deal.id);
      if (seenIdsBefore.has(deal.id)) continue;
      const seenH = hashesBefore.get(contentHash(deal));
      if (seenH && (now - seenH) < DEDUP_WINDOW_MS) continue;
      const seenF = fuzziesBefore.get(fuzzyHash(deal));
      if (seenF && (now - seenF) < DEDUP_WINDOW_MS) continue;

      const list = profileMatches.get(deal.id) ?? [];
      list.push(profile.id);
      profileMatches.set(deal.id, list);

      if (mode === 'realtime') {
        realtimeSends.push({ deal, profile, attempts: 0, urls: profile.appriseUrls, deliveredBefore: false });
      } else {
        enqueue(queue, profile.id, deal, now);
        queuedIds.add(deal.id);
      }
    }
  }

  // Step 3: realtime delivery, sequential with inter-post delay. Destinations
  // that fail are retried on the next poll(s) — only those destinations, so
  // ones that already received the deal don't get it twice.
  let notified = 0;
  const historyBatch = [];
  for (let i = 0; i < realtimeSends.length; i++) {
    const { deal, profile, attempts, urls, deliveredBefore } = realtimeSends[i];
    let result = null;
    try {
      result = await deps.sendDealNotification(deal, urls);
    } catch (err) {
      log.error(`Notification error for "${deal.title}": ${err.message}`);
    }
    const failed = failedTargets(urls, result);
    const delivered = urls.length - failed.length;
    if (delivered > 0) {
      notifiedIds.add(deal.id);
      if (!deliveredBefore) {
        // Count/record a deal once, the first time it reaches any destination.
        notified++;
        historyBatch.push(deal);
      }
      log.info(`Notified [${profile.id}]: ${deal.title} [${deal.category}] (+${deal.votes})` +
        (failed.length > 0 ? ` — ${failed.length} of ${urls.length} destination(s) failed, will retry` : ''));
    }
    if (failed.length > 0) {
      addRetry(profile.id, deal, attempts + 1, failed, deliveredBefore || delivered > 0);
    }
    if (i < realtimeSends.length - 1) {
      await deps.sleep(INTER_POST_DELAY_MS);
    }
  }
  await addToHistory(config.dataDir, historyBatch);

  // Step 4: "quiet → realtime" flush. If a profile was non-realtime last cycle
  // but is realtime now, drain its queue immediately as one digest.
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

  // Step 5: mark every fetched deal (including in-batch duplicates) seen.
  // Re-inserting ids keeps still-live deals at the "recent" end so trimming
  // to maxSeenDeals evicts the oldest ones first.
  for (const deal of raw) {
    seenIds.delete(deal.id);
    seenIds.add(deal.id);
    hashes.set(contentHash(deal), now);
    fuzzies.set(fuzzyHash(deal), now);
  }
  for (const source of newSources) _seededSources.add(source);

  // Step 6: persist.
  await saveSeenDeals(seenIds, hashes, fuzzies, config.dataDir, config.maxSeenDeals);
  await saveQueue(config.dataDir, queue);

  if (fetched.length > 0) {
    const filteredArr = fetched.filter(d => filteredAny.has(d.id));
    await logDeals(
      config.dataDir,
      fetched,
      filteredArr,
      seenIdsBefore,
      hashesBefore,
      fuzziesBefore,
      notifiedIds,
      profileMatches,
      queuedIds,
      config,
    );
    touchHealth();
  }

  // Re-arm digest timers in case schedules shifted across the poll boundary.
  if (_pollTimer !== null) rescheduleDigestTimers(config);

  return notified;
}

/**
 * On startup, optionally sends the most recent unseen matching deal for the
 * first profile (so the user sees the bot is live), then seeds everything else
 * as seen. Any source that fails to fetch here is seeded on its first
 * successful poll instead, so a network outage at boot never causes a flood.
 */
export async function startMonitor(config) {
  _activeConfig = config;
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  const now = Date.now();
  for (const p of profiles) _lastMode.set(p.id, currentMode(p, now));

  try {
    await withLock(async () => {
      const fetched = await deps.fetchAllDeals(config);
      await ensureQueue(config);
      const { ids: seenIds, hashes, fuzzies } = await loadSeenDeals(config.dataDir);

      if (config.startupNotification !== false && profiles.length > 0 && fetched.length > 0) {
        const head = profiles[0];
        const latest = filterForProfile(fetched, head).find(d => !seenIds.has(d.id));
        if (latest) {
          log.info(`Sending startup deal: ${latest.title} [profile=${head.id}]`);
          await deps.sendDealNotification(latest, head.appriseUrls);
        }
      }

      for (const deal of fetched) {
        seenIds.delete(deal.id);
        seenIds.add(deal.id);
        hashes.set(contentHash(deal), now);
        fuzzies.set(fuzzyHash(deal), now);
        _seededSources.add(deal.source);
      }
      await saveSeenDeals(seenIds, hashes, fuzzies, config.dataDir, config.maxSeenDeals);

      if (fetched.length === 0) {
        log.warn('Startup fetch returned no deals — sources will be seeded on their first successful poll.');
      }
    });
  } catch (err) {
    log.error(`Startup seeding failed: ${err.message} — sources will be seeded on their first successful poll.`);
  }
  touchHealth();

  log.info(`Ready. Watching for new deals every ${config.pollIntervalMs / 1000}s...`);
  startPollLoop(config);
}

// ── Test hooks ────────────────────────────────────────────────────────────────

/** Overrides side-effecting dependencies (fetch, send, sleep). Pass null to restore. */
export function __setTestDeps(overrides) {
  deps = overrides ? { ...defaultDeps, ...overrides } : { ...defaultDeps };
}

/** Resets all module state. `seededSources` pre-marks sources as seeded. */
export function __resetState({ seededSources = [] } = {}) {
  stopPollLoop();
  _lock = Promise.resolve();
  _activeQueue = null;
  _activeConfig = null;
  _lastMode = new Map();
  _seededSources = new Set(seededSources);
  _retries = new Map();
  lastSuccessfulPoll = 0;
}
