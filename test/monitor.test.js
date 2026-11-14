import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { runOnce, dedupeBatch, MAX_SEND_ATTEMPTS, __setTestDeps, __resetState } from '../src/monitor.js';
import { loadDealLog } from '../src/dealLog.js';

function deal(overrides = {}) {
  return {
    id: 'ozb-1', title: 'Cheap Thing $10 @ Store', link: 'https://example.com/1',
    category: 'Computing', price: '$10', votes: 5, source: 'ozbargain', store: 'Store',
    description: '', ...overrides,
  };
}

let dataDir;
let sent;
let feed;
let sendOk;

function config() {
  return {
    profiles: [{
      id: 'a', name: 'A', appriseUrls: ['json://example'], categories: [], keywords: [], minVotes: 0,
      schedule: { timezone: 'UTC', mode: 'realtime', quietHours: [], digestAt: '08:00' },
    }],
    dataDir,
    maxSeenDeals: 500,
    pollIntervalMs: 60_000,
    gamingSources: {},
  };
}

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mon-'));
  sent = [];
  feed = [];
  sendOk = () => true;
  __resetState({ seededSources: ['ozbargain', 'gamerpower', 'gamerpower-games'] });
  __setTestDeps({
    fetchAllDeals: async () => feed,
    sendDealNotification: async (d) => { sent.push(d.id); return { ok: sendOk(d) }; },
    sendDigest: async () => ({ ok: true }),
    sleep: async () => {},
  });
});

afterEach(async () => {
  __resetState();
  __setTestDeps(null);
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('dedupeBatch', () => {
  it('drops repeated ids, identical content and cross-source copies', () => {
    const out = dedupeBatch([
      deal({ id: 'gamerpower:1', title: 'Free Game', price: 'Free', source: 'gamerpower' }),
      deal({ id: 'gamerpower:1', title: 'Free Game', price: 'Free', source: 'gamerpower-games' }),
      deal({ id: 'ozb-2', title: 'Another Deal', price: '$5' }),
      deal({ id: 'epic-9', title: 'ANOTHER deal!', price: '$5', source: 'epicbundle' }),
    ]);
    assert.deepStrictEqual(out.map(d => d.id), ['gamerpower:1', 'ozb-2']);
  });
});

describe('runOnce', () => {
  it('notifies a deal returned by two gaming feeds only once', async () => {
    feed = [
      deal({ id: 'gamerpower:7', title: 'Free Game', price: 'Free', source: 'gamerpower' }),
      deal({ id: 'gamerpower:7', title: 'Free Game', price: 'Free', source: 'gamerpower-games' }),
    ];
    assert.strictEqual(await runOnce(config()), 1);
    assert.deepStrictEqual(sent, ['gamerpower:7']);
  });

  it('does not re-notify on the next poll', async () => {
    feed = [deal()];
    await runOnce(config());
    await runOnce(config());
    assert.deepStrictEqual(sent, ['ozb-1']);
  });

  it('serialises concurrent polls so a deal is sent once', async () => {
    feed = [deal()];
    await Promise.all([runOnce(config()), runOnce(config())]);
    assert.deepStrictEqual(sent, ['ozb-1']);
  });

  it('retries a failed send on the next poll', async () => {
    feed = [deal()];
    sendOk = () => false;
    assert.strictEqual(await runOnce(config()), 0);
    sendOk = () => true;
    assert.strictEqual(await runOnce(config()), 1);
    await runOnce(config());
    assert.deepStrictEqual(sent, ['ozb-1', 'ozb-1']);
  });

  it(`gives up after ${MAX_SEND_ATTEMPTS} failed attempts`, async () => {
    feed = [deal()];
    sendOk = () => false;
    for (let i = 0; i < MAX_SEND_ATTEMPTS + 2; i++) await runOnce(config());
    assert.strictEqual(sent.length, MAX_SEND_ATTEMPTS);
  });

  it('labels a failed send as "notification failed" in the deal log', async () => {
    feed = [deal()];
    sendOk = () => false;
    await runOnce(config());
    const [entry] = await loadDealLog(dataDir);
    assert.strictEqual(entry.filterReason, 'notification failed');
    assert.strictEqual(entry.wasNotified, false);
  });

  it('seeds a source silently the first time it returns deals', async () => {
    __resetState({ seededSources: [] });
    feed = [deal(), deal({ id: 'ozb-2', title: 'Other $3', price: '$3' })];
    assert.strictEqual(await runOnce(config()), 0);
    feed = [...feed, deal({ id: 'ozb-3', title: 'New one $1', price: '$1' })];
    assert.strictEqual(await runOnce(config()), 1);
    assert.deepStrictEqual(sent, ['ozb-3']);
  });

  it('queues deals for digest profiles instead of sending', async () => {
    const cfg = config();
    cfg.profiles[0].schedule = { timezone: 'UTC', mode: 'digest', quietHours: [], digestAt: '08:00' };
    feed = [deal()];
    assert.strictEqual(await runOnce(cfg), 0);
    assert.deepStrictEqual(sent, []);
    const queue = JSON.parse(await fs.readFile(path.join(dataDir, 'pending-digest.json'), 'utf8'));
    assert.strictEqual(queue.a.length, 1);
  });
});
