import fs from 'node:fs';
import path from 'node:path';

const FILE = 'settings.json';
const TMP  = 'settings.tmp.json';

export async function loadSettings(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, FILE), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validate(s) {
  const urls = Array.isArray(s.appriseUrls) ? s.appriseUrls.map(u => u.trim()).filter(Boolean) : [];
  if (urls.length === 0) {
    const e = new Error('At least one notification URL is required.');
    e.field = 'appriseUrls';
    throw e;
  }
  const interval = Number(s.pollIntervalSeconds);
  if (!Number.isInteger(interval) || interval < 30) {
    const e = new Error('Poll interval must be a whole number ≥ 30.');
    e.field = 'pollIntervalSeconds';
    throw e;
  }
  const minVotes = Number(s.minVotes);
  if (!Number.isInteger(minVotes) || minVotes < 0) {
    const e = new Error('Minimum votes must be a whole number ≥ 0.');
    e.field = 'minVotes';
    throw e;
  }
  const maxSeen = Number(s.maxSeenDeals);
  if (!Number.isInteger(maxSeen) || maxSeen < 1) {
    const e = new Error('Max seen deals must be a whole number ≥ 1.');
    e.field = 'maxSeenDeals';
    throw e;
  }
}

export async function saveSettings(dataDir, settings) {
  validate(settings);

  const gs = settings.gamingSources ?? {};
  const payload = {
    appriseUrls:         settings.appriseUrls.map(u => u.trim()).filter(Boolean),
    categories:          Array.isArray(settings.categories) ? settings.categories.map(c => c.trim()).filter(Boolean) : [],
    keywords:            Array.isArray(settings.keywords)   ? settings.keywords.map(k => k.trim()).filter(Boolean)   : [],
    pollIntervalSeconds: Number(settings.pollIntervalSeconds),
    minVotes:            Number(settings.minVotes),
    maxSeenDeals:        Number(settings.maxSeenDeals),
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
