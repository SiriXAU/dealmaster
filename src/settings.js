import fs from 'node:fs';
import path from 'node:path';
import { parseHHMM, validateTimezone } from './scheduler.js';

const FILE = 'settings.json';
const TMP  = 'settings.tmp.json';

const PROFILE_ID_RE = /^[a-z0-9-]{1,32}$/;

export async function loadSettings(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return migrateLegacySettings(parsed);
  } catch {
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

  const migrated = {
    profiles:            [profile],
    pollIntervalSeconds: s.pollIntervalSeconds,
    maxSeenDeals:        s.maxSeenDeals,
    gamingSources:       s.gamingSources,
    savedAt:             s.savedAt,
  };
  return migrated;
}

export function defaultSchedule() {
  return {
    timezone:   'UTC',
    mode:       'realtime',
    quietHours: [],
    digestAt:   '08:00',
  };
}

function validateSchedule(sch, profileId) {
  if (sch == null) return defaultSchedule();
  if (typeof sch !== 'object' || Array.isArray(sch)) {
    const e = new Error(`Profile "${profileId}" schedule must be an object`);
    e.field = 'schedule';
    throw e;
  }
  const timezone = validateTimezone(sch.timezone) ?? 'UTC';
  const mode = ['realtime', 'digest', 'quiet'].includes(sch.mode) ? sch.mode : 'realtime';
  const quietHours = [];
  if (Array.isArray(sch.quietHours)) {
    for (const w of sch.quietHours) {
      if (!w || !parseHHMM(w.from) || !parseHHMM(w.to)) {
        const e = new Error(`Profile "${profileId}" quiet hours must use HH:mm format`);
        e.field = 'schedule.quietHours';
        throw e;
      }
      quietHours.push({ from: w.from, to: w.to });
    }
  }
  if (sch.digestAt != null && !parseHHMM(sch.digestAt)) {
    const e = new Error(`Profile "${profileId}" digestAt must use HH:mm format`);
    e.field = 'schedule.digestAt';
    throw e;
  }
  return {
    timezone,
    mode,
    quietHours,
    digestAt: sch.digestAt ?? '08:00',
  };
}

function validateProfile(p, seenIds) {
  if (!p || typeof p !== 'object') {
    const e = new Error('Profile must be an object');
    e.field = 'profiles';
    throw e;
  }
  const id = String(p.id ?? '').trim();
  if (!PROFILE_ID_RE.test(id)) {
    const e = new Error('Profile id must be 1–32 lowercase alphanumeric or hyphen characters');
    e.field = 'profiles.id';
    throw e;
  }
  if (seenIds.has(id)) {
    const e = new Error(`Profile id "${id}" is duplicated`);
    e.field = 'profiles.id';
    throw e;
  }
  seenIds.add(id);

  const urls = Array.isArray(p.appriseUrls) ? p.appriseUrls.map(u => String(u).trim()).filter(Boolean) : [];
  if (urls.length === 0) {
    const e = new Error(`Profile "${id}" needs at least one notification URL`);
    e.field = 'profiles.appriseUrls';
    throw e;
  }

  const minVotes = Number(p.minVotes);
  if (!Number.isInteger(minVotes) || minVotes < 0) {
    const e = new Error(`Profile "${id}" minVotes must be a whole number ≥ 0`);
    e.field = 'profiles.minVotes';
    throw e;
  }

  return {
    id,
    name:        String(p.name ?? id).slice(0, 64),
    appriseUrls: urls,
    categories:  Array.isArray(p.categories) ? p.categories.map(c => String(c).trim()).filter(Boolean) : [],
    keywords:    Array.isArray(p.keywords)   ? p.keywords.map(k => String(k).trim()).filter(Boolean)   : [],
    minVotes,
    schedule:    validateSchedule(p.schedule, id),
  };
}

function validate(s) {
  // Either accept new shape (profiles[]) or auto-migrate a legacy payload.
  const migrated = (Array.isArray(s.profiles) && s.profiles.length > 0)
    ? s
    : migrateLegacySettings(s);

  if (!Array.isArray(migrated.profiles) || migrated.profiles.length === 0) {
    const e = new Error('At least one profile is required.');
    e.field = 'profiles';
    throw e;
  }

  const seenIds = new Set();
  const profiles = migrated.profiles.map(p => validateProfile(p, seenIds));

  const interval = Number(migrated.pollIntervalSeconds ?? 120);
  if (!Number.isInteger(interval) || interval < 30) {
    const e = new Error('Poll interval must be a whole number ≥ 30.');
    e.field = 'pollIntervalSeconds';
    throw e;
  }

  const maxSeen = Number(migrated.maxSeenDeals ?? 500);
  if (!Number.isInteger(maxSeen) || maxSeen < 1) {
    const e = new Error('Max seen deals must be a whole number ≥ 1.');
    e.field = 'maxSeenDeals';
    throw e;
  }

  return { migrated, profiles, interval, maxSeen };
}

export async function saveSettings(dataDir, settings) {
  const { profiles, interval, maxSeen } = validate(settings);

  const gs = settings.gamingSources ?? {};
  const payload = {
    profiles,
    pollIntervalSeconds: interval,
    maxSeenDeals:        maxSeen,
    gamingSources: {
      gamerpower:      Boolean(gs.gamerpower),
      gamerpowerGames: Boolean(gs.gamerpowerGames),
      gamerpowerLoot:  Boolean(gs.gamerpowerLoot),
      epicbundle:      Boolean(gs.epicbundle),
    },
    savedAt:             new Date().toISOString(),
  };

  fs.mkdirSync(dataDir, { recursive: true });
  const tmpPath   = path.join(dataDir, TMP);
  const finalPath = path.join(dataDir, FILE);
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, finalPath);

  return payload;
}
