import { createLogger } from './logger.js';

const log = createLogger('config');

/**
 * Loads and validates configuration from saved settings (web UI) with env var fallback.
 * savedSettings (from settings.json) takes precedence over env vars for every field it contains.
 */
export function loadConfig(savedSettings = null) {
  const s = savedSettings ?? {};

  const rawAppriseUrls = Array.isArray(s.appriseUrls)
    ? s.appriseUrls.join(',')
    : (process.env.APPRISE_URLS ?? '');
  const appriseUrls = rawAppriseUrls
    .split(',')
    .map(u => u.trim())
    .filter(u => u.length > 0);

  if (appriseUrls.length === 0) {
    log.error('APPRISE_URLS environment variable is required.');
    log.error('Set it to one or more Apprise notification URLs (comma-separated), e.g.:');
    log.error('  docker run -e APPRISE_URLS="discord://YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN" dealmaster');
    log.error('  See https://github.com/caronc/apprise/wiki for all supported services.');
    process.exit(1);
  }

  const pollIntervalSeconds = s.pollIntervalSeconds != null
    ? Number(s.pollIntervalSeconds)
    : parseInt(process.env.POLL_INTERVAL_SECONDS ?? '120', 10);
  if (isNaN(pollIntervalSeconds) || pollIntervalSeconds < 30) {
    log.error('POLL_INTERVAL_SECONDS must be a number >= 30');
    process.exit(1);
  }

  const categories = Array.isArray(s.categories)
    ? s.categories
    : (process.env.CATEGORIES ?? '')
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);

  const keywords = Array.isArray(s.keywords)
    ? s.keywords
    : (process.env.KEYWORDS ?? '')
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);

  const minVotes     = s.minVotes     != null ? Number(s.minVotes)     : parseInt(process.env.MIN_VOTES      ?? '0',   10);
  const maxSeenDeals = s.maxSeenDeals != null ? Number(s.maxSeenDeals) : parseInt(process.env.MAX_SEEN_DEALS ?? '500', 10);
  const dataDir      = process.env.DATA_DIR ?? '/data';

  const gs = s.gamingSources ?? {};
  const gamingSources = Object.freeze({
    gamerpower:      gs.gamerpower      != null ? Boolean(gs.gamerpower)      : (process.env.GAMERPOWER_ENABLED        === 'true'),
    gamerpowerGames: gs.gamerpowerGames != null ? Boolean(gs.gamerpowerGames) : (process.env.GAMERPOWER_GAMES_ENABLED  === 'true'),
    gamerpowerLoot:  gs.gamerpowerLoot  != null ? Boolean(gs.gamerpowerLoot)  : (process.env.GAMERPOWER_LOOT_ENABLED   === 'true'),
    epicbundle:      gs.epicbundle      != null ? Boolean(gs.epicbundle)      : (process.env.EPICBUNDLE_ENABLED        === 'true'),
  });

  return Object.freeze({
    appriseUrls,
    categories,
    keywords,
    pollIntervalMs: pollIntervalSeconds * 1000,
    minVotes:       isNaN(minVotes)     ? 0   : minVotes,
    maxSeenDeals:   isNaN(maxSeenDeals) ? 500 : maxSeenDeals,
    dataDir,
    gamingSources,
  });
}
