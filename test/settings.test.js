import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadSettings, saveSettings, migrateLegacySettings } from '../src/settings.js';

async function tmp() {
  const dir = path.join(os.tmpdir(), `set-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('migrateLegacySettings', () => {
  it('wraps legacy fields into a single default profile', () => {
    const legacy = {
      appriseUrls: ['discord://1/abc'],
      categories:  ['Computing'],
      keywords:    ['Free'],
      minVotes:    25,
      pollIntervalSeconds: 90,
      maxSeenDeals: 200,
      gamingSources: { gamerpower: true },
      savedAt: '2026-01-01T00:00:00.000Z',
    };
    const m = migrateLegacySettings(legacy);
    assert.strictEqual(m.profiles.length, 1);
    const p = m.profiles[0];
    assert.strictEqual(p.id, 'default');
    assert.deepStrictEqual(p.appriseUrls, ['discord://1/abc']);
    assert.deepStrictEqual(p.categories,  ['Computing']);
    assert.deepStrictEqual(p.keywords,    ['Free']);
    assert.strictEqual(p.minVotes, 25);
    assert.strictEqual(m.pollIntervalSeconds, 90);
    assert.strictEqual(m.maxSeenDeals, 200);
    assert.deepStrictEqual(m.gamingSources, { gamerpower: true });
  });

  it('is idempotent when profiles[] already present', () => {
    const already = { profiles: [{ id: 'x', appriseUrls: ['discord://1/a'], categories: [], keywords: [], minVotes: 0 }] };
    assert.strictEqual(migrateLegacySettings(already), already);
  });
});

describe('saveSettings + loadSettings', () => {
  it('round-trips a profile-shaped payload', async () => {
    const dir = await tmp();
    try {
      const payload = {
        profiles: [
          {
            id: 'default', name: 'Default',
            appriseUrls: ['discord://1/abc'],
            categories: ['Computing'], keywords: ['Free'], minVotes: 0,
            schedule: { mode: 'realtime', timezone: 'UTC', quietHours: [], digestAt: '08:00' },
          },
          {
            id: 'gaming', name: 'Gaming',
            appriseUrls: ['tgram://t/c'],
            categories: ['Gaming'], keywords: [], minVotes: 0,
            schedule: { mode: 'digest', timezone: 'Australia/Sydney', quietHours: [{ from: '22:00', to: '07:00' }], digestAt: '09:00' },
          },
        ],
        pollIntervalSeconds: 120,
        maxSeenDeals: 500,
        gamingSources: { gamerpower: false, gamerpowerGames: false, gamerpowerLoot: false, epicbundle: false },
      };
      await saveSettings(dir, payload);
      const loaded = await loadSettings(dir);
      assert.strictEqual(loaded.profiles.length, 2);
      assert.strictEqual(loaded.profiles[1].schedule.mode, 'digest');
      assert.strictEqual(loaded.profiles[1].schedule.quietHours[0].from, '22:00');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects bad timezones', async () => {
    const dir = await tmp();
    try {
      await assert.rejects(() => saveSettings(dir, {
        profiles: [{
          id: 'x', appriseUrls: ['discord://1/a'], categories: [], keywords: [], minVotes: 0,
          schedule: { mode: 'realtime', timezone: 'UTC', quietHours: [{ from: 'bad', to: '07:00' }], digestAt: '08:00' },
        }],
      }), /HH:mm/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects duplicate profile ids', async () => {
    const dir = await tmp();
    try {
      await assert.rejects(() => saveSettings(dir, {
        profiles: [
          { id: 'a', appriseUrls: ['discord://1/a'], categories: [], keywords: [], minVotes: 0 },
          { id: 'a', appriseUrls: ['discord://1/b'], categories: [], keywords: [], minVotes: 0 },
        ],
      }), /duplicated/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects profiles with no Apprise URL', async () => {
    const dir = await tmp();
    try {
      await assert.rejects(() => saveSettings(dir, {
        profiles: [{ id: 'a', appriseUrls: [], categories: [], keywords: [], minVotes: 0 }],
      }), /notification URL/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('migrates a legacy settings.json on load', async () => {
    const dir = await tmp();
    try {
      const legacyPath = path.join(dir, 'settings.json');
      await fs.writeFile(legacyPath, JSON.stringify({
        appriseUrls: ['discord://1/abc'],
        categories: ['Computing'],
        keywords: [],
        minVotes: 0,
        pollIntervalSeconds: 120,
        maxSeenDeals: 500,
      }));
      const loaded = await loadSettings(dir);
      assert.strictEqual(loaded.profiles.length, 1);
      assert.strictEqual(loaded.profiles[0].id, 'default');
      assert.deepStrictEqual(loaded.profiles[0].appriseUrls, ['discord://1/abc']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
