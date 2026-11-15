import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHHMM, validateTimezone } from './scheduler.js';
import { writeFileAtomic } from './fsUtil.js';
import { createLogger } from './logger.js';

const log = createLogger('settings');

const FILE = 'settings.json';

const PROFILE_ID_RE = /^[a-z0-9-]{1,32}$/;
const SCHEDULE_MODES = ['realtime', 'digest', 'quiet'];
const GAMING_SOURCE_KEYS = ['gamerpower', 'gamerpowerGames', 'gamerpowerLoot', 'epicbundle'];

export async function loadSettings(dataDir) {
  const filePath = path.join(dataDir, FILE);
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log.error(`Could not read ${filePath}: ${err.message}`);
    return null;
  }
  try {
    return migrateLegacySettings(JSON.parse(raw));
  } catch (err) {
    log.error(`${filePath} is not valid JSON (${err.message}) — falling back to environment variables`);
    return null;
  }
}

/**
 * Wraps legacy single-filter settings into a single "default" profile.
 * Idempotent: returns the input unchanged if `profiles[]` already exists.
 */
export function migrateLegacySettings(s) {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s.profiles) && s.profiles.length > 0) return s;

  const profile = {
    id:          'default',
    name:        'Default',
    appriseUrls: Array.isArray(s.appriseUrls) ? s.appriseUrls : [],
    categories:  Array.isArray(s.categories)  ? s.categories  : [],
    keywords:    Array.isArray(s.keywords)    ? s.keywords    : [],
    minVotes:    Number.isFinite(Number(s.minVotes)) ? Number(s.minVotes) : 0,
    schedule:    defaultSchedule(),
  };

  return {
    profiles:            [profile],
    pollIntervalSeconds: s.pollIntervalSeconds,
    maxSeenDeals:        s.maxSeenDeals,
    gamingSources:       s.gamingSources,
    savedAt:             s.savedAt,
  };
}

export function defaultSchedule() {
  return {
    timezone:   'UTC',
    mode:       'realtime',
    quietHours: [],
    digestAt:   '08:00',
  };
}

function fail(message, field) {
  const e = new Error(message);
  e.field = field;
  throw e;
}

function validateStringList(list, profileId, name) {
  if (list == null) return [];
  if (!Array.isArray(list)) fail(`Profile "${profileId}" ${name} must be an array`, `profiles.${name}`);
  for (const v of list) {
    if (typeof v !== 'string') fail(`Profile "${profileId}" ${name} must be strings`, `profiles.${name}`);
  }
  return list.map(v => v.trim()).filter(Boolean);
}

function validateSchedule(sch, profileId) {
  if (sch == null) return defaultSchedule();
  if (typeof sch !== 'object' || Array.isArray(sch)) {
    fail(`Profile "${profileId}" schedule must be an object`, 'profiles.schedule');
  }

  let timezone = 'UTC';
  if (sch.timezone != null && sch.timezone !== '') {
    timezone = validateTimezone(sch.timezone);
    if (!timezone) fail(`Profile "${profileId}" timezone is invalid`, 'profiles.schedule.timezone');
  }

  let mode = 'realtime';
  if (sch.mode != null) {
    if (!SCHEDULE_MODES.includes(sch.mode)) {
      fail(`Profile "${profileId}" schedule.mode must be realtime/digest/quiet`, 'profiles.schedule.mode');
    }
    mode = sch.mode;
  }

  const quietHours = [];
  if (sch.quietHours != null) {
    if (!Array.isArray(sch.quietHours)) {
      fail(`Profile "${profileId}" quietHours must be an array`, 'profiles.schedule.quietHours');
    }
    for (const w of sch.quietHours) {
      if (!w || !parseHHMM(w.from) || !parseHHMM(w.to)) {
        fail(`Profile "${profileId}" quiet hours must use HH:mm format`, 'profiles.schedule.quietHours');
      }
      quietHours.push({ from: w.from, to: w.to });
    }
  }

  if (sch.digestAt != null && !parseHHMM(sch.digestAt)) {
    fail(`Profile "${profileId}" digestAt must use HH:mm format`, 'profiles.schedule.digestAt');
  }

  return {
    timezone,
    mode,
    quietHours,
    digestAt: sch.digestAt ?? '08:00',
  };
}

function validateProfile(p, seenIds) {
  if (!p || typeof p !== 'object') fail('Profile must be an object', 'profiles');

  const id = String(p.id ?? '').trim();
  if (!PROFILE_ID_RE.test(id)) {
    fail('Profile id must be 1–32 lowercase alphanumeric or hyphen characters', 'profiles.id');
  }
  if (seenIds.has(id)) fail(`Profile id "${id}" is duplicated`, 'profiles.id');
  seenIds.add(id);

  if (p.appriseUrls != null && !Array.isArray(p.appriseUrls)) {
    fail(`Profile "${id}" appriseUrls must be an array`, 'profiles.appriseUrls');
  }
  const urls = [];
  for (const u of p.appriseUrls ?? []) {
    if (typeof u !== 'string') fail(`Profile "${id}" notification URLs must be strings`, 'profiles.appriseUrls');
    const trimmed = u.trim();
    if (!trimmed) continue;
    // A leading dash would be parsed by the apprise CLI as an option
    // (e.g. --attach=/some/file), so never accept one as a URL.
    if (trimmed.startsWith('-')) {
      fail(`Profile "${id}" notification URL must not start with "-"`, 'profiles.appriseUrls');
    }
    urls.push(trimmed);
  }
  if (urls.length === 0) fail(`Profile "${id}" needs at least one notification URL`, 'profiles.appriseUrls');

  const minVotes = Number(p.minVotes ?? 0);
  if (!Number.isInteger(minVotes) || minVotes < 0) {
    fail(`Profile "${id}" minVotes must be a whole number ≥ 0`, 'profiles.minVotes');
  }

  return {
    id,
    name:        String(p.name ?? id).slice(0, 64),
    appriseUrls: urls,
    categories:  validateStringList(p.categories, id, 'categories'),
    keywords:    validateStringList(p.keywords,   id, 'keywords'),
    minVotes,
    schedule:    validateSchedule(p.schedule, id),
  };
}

function validateGamingSources(gs) {
  if (gs == null) return Object.fromEntries(GAMING_SOURCE_KEYS.map(k => [k, false]));
  if (typeof gs !== 'object' || Array.isArray(gs)) fail('gamingSources must be an object', 'gamingSources');
  for (const [key, val] of Object.entries(gs)) {
    if (typeof val !== 'boolean') fail(`gamingSources.${key} must be a boolean`, 'gamingSources');
  }
  return Object.fromEntries(GAMING_SOURCE_KEYS.map(k => [k, Boolean(gs[k])]));
}

/**
 * Validates and normalises a settings payload (new or legacy shape).
 * This is the single source of truth for settings validation — both the web
 * API and saveSettings go through it.
 *
 * @returns normalised settings (without savedAt)
 * @throws Error with a `.field` property on invalid input
 */
export function normaliseSettings(s) {
  if (s == null || typeof s !== 'object' || Array.isArray(s)) fail('Request body must be a JSON object', null);

  const migrated = (Array.isArray(s.profiles) && s.profiles.length > 0)
    ? s
    : migrateLegacySettings(s);

  if (!Array.isArray(migrated.profiles) || migrated.profiles.length === 0) {
    fail('At least one profile is required.', 'profiles');
  }

  const seenIds = new Set();
  const profiles = migrated.profiles.map(p => validateProfile(p, seenIds));

  const interval = Number(migrated.pollIntervalSeconds ?? 120);
  if (!Number.isInteger(interval) || interval < 30) {
    fail('Poll interval must be a whole number ≥ 30.', 'pollIntervalSeconds');
  }

  const maxSeen = Number(migrated.maxSeenDeals ?? 500);
  if (!Number.isInteger(maxSeen) || maxSeen < 1) {
    fail('Max seen deals must be a whole number ≥ 1.', 'maxSeenDeals');
  }

  return {
    profiles,
    pollIntervalSeconds: interval,
    maxSeenDeals:        maxSeen,
    gamingSources:       validateGamingSources(migrated.gamingSources),
  };
}

export async function saveSettings(dataDir, settings) {
  const payload = {
    ...normaliseSettings(settings),
    savedAt: new Date().toISOString(),
  };
  await writeFileAtomic(path.join(dataDir, FILE), JSON.stringify(payload, null, 2));
  return payload;
}
