import { createLogger } from './logger.js';
import { defaultSchedule, migrateLegacySettings } from './settings.js';

const log = createLogger('config');

/**
 * Loads and validates configuration from saved settings (web UI) with env var fallback.
 * savedSettings (from settings.json) takes precedence over env vars for every field it contains.
 *
 * Returned shape includes both the new `profiles[]` array AND legacy aliases
 * (`appriseUrls`, `categories`, `keywords`, `minVotes`) derived from profiles[0],
 * so callers that haven't migrated yet keep working.
 */
export function loadConfig(savedSettings = null) {
  // If a legacy-shape object is passed in (no profiles[] but legacy fields),
  // migrate it on the fly so callers can keep using the old shape.
  const s = savedSettings == null
    ? {}
    : (Array.isArray(savedSettings.profiles) && savedSettings.profiles.length > 0)
        ? savedSettings
        : migrateLegacySettings(savedSettings);

  const profiles = Array.isArray(s.profiles) && s.profiles.length > 0
    ? s.profiles.map(normaliseProfile)
    : [profileFromEnv()];

  if (profiles.length === 0 || profiles[0].appriseUrls.length === 0) {
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

  const maxSeenDealsRaw = s.maxSeenDeals != null ? Number(s.maxSeenDeals) : parseInt(process.env.MAX_SEEN_DEALS ?? '500', 10);
  const dataDir         = process.env.DATA_DIR ?? '/data';

  const gs = s.gamingSources ?? {};
  const gamingSources = Object.freeze({
    gamerpower:      gs.gamerpower      != null ? Boolean(gs.gamerpower)      : (process.env.GAMERPOWER_ENABLED        === 'true'),
    gamerpowerGames: gs.gamerpowerGames != null ? Boolean(gs.gamerpowerGames) : (process.env.GAMERPOWER_GAMES_ENABLED  === 'true'),
    gamerpowerLoot:  gs.gamerpowerLoot  != null ? Boolean(gs.gamerpowerLoot)  : (process.env.GAMERPOWER_LOOT_ENABLED   === 'true'),
    epicbundle:      gs.epicbundle      != null ? Boolean(gs.epicbundle)      : (process.env.EPICBUNDLE_ENABLED        === 'true'),
  });

  const head = profiles[0];
  return Object.freeze({
    profiles,
    // Legacy aliases mirroring profiles[0] — kept so older callers/tests don't break.
    appriseUrls:    head.appriseUrls,
    categories:     head.categories,
    keywords:       head.keywords,
    minVotes:       head.minVotes,
    pollIntervalMs: pollIntervalSeconds * 1000,
    maxSeenDeals:   isNaN(maxSeenDealsRaw) ? 500 : maxSeenDealsRaw,
    dataDir,
    gamingSources,
  });
}

function normaliseProfile(p) {
  return Object.freeze({
    id:          p.id,
    name:        p.name ?? p.id,
    appriseUrls: Array.isArray(p.appriseUrls) ? p.appriseUrls : [],
    categories:  Array.isArray(p.categories)  ? p.categories  : [],
    keywords:    Array.isArray(p.keywords)    ? p.keywords    : [],
    minVotes:    Number.isFinite(Number(p.minVotes)) ? Number(p.minVotes) : 0,
    schedule:    p.schedule ?? defaultSchedule(),
  });
}

function profileFromEnv() {
  const rawAppriseUrls = process.env.APPRISE_URLS ?? '';
  const appriseUrls = rawAppriseUrls
    .split(',')
    .map(u => u.trim())
    .filter(u => u.length > 0);

  const categories = (process.env.CATEGORIES ?? '')
    .split(',')
    .map(c => c.trim())
    .filter(c => c.length > 0);

  const keywords = (process.env.KEYWORDS ?? '')
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);

  const minVotes = parseInt(process.env.MIN_VOTES ?? '0', 10);

  return Object.freeze({
    id:          'default',
    name:        'Default',
    appriseUrls,
    categories,
    keywords,
    minVotes:    isNaN(minVotes) ? 0 : minVotes,
    schedule:    defaultSchedule(),
  });
}
