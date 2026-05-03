import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('config', () => {
  it('loads defaults from environment', async () => {
    process.env.APPRISE_URLS = 'discord://1/abc';
    process.env.POLL_INTERVAL_SECONDS = '60';
    process.env.MIN_VOTES = '5';
    // Force re-import so env vars are picked up and process.exit isn't called
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(null);
    assert.deepStrictEqual(config.appriseUrls, ['discord://1/abc']);
    assert.strictEqual(config.pollIntervalMs, 60000);
    assert.strictEqual(config.minVotes, 5);
    assert.strictEqual(config.maxSeenDeals, 500);
    assert.deepStrictEqual(config.categories, []);
    assert.deepStrictEqual(config.keywords, []);
  });

  it('categories from comma-separated env', async () => {
    process.env.APPRISE_URLS = 'discord://1/abc';
    process.env.CATEGORIES = 'Computing, Gaming';
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(null);
    assert.deepStrictEqual(config.categories, ['Computing', 'Gaming']);
    delete process.env.CATEGORIES;
  });

  it('keywords from comma-separated env', async () => {
    process.env.APPRISE_URLS = 'discord://1/abc';
    process.env.KEYWORDS = 'free, steam';
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(null);
    assert.deepStrictEqual(config.keywords, ['free', 'steam']);
    delete process.env.KEYWORDS;
  });

  it('saved settings override env vars', async () => {
    process.env.APPRISE_URLS = 'discord://1/env';
    process.env.POLL_INTERVAL_SECONDS = '120';
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig({
      appriseUrls: ['discord://2/saved'],
      pollIntervalSeconds: 90,
      minVotes: 10,
      maxSeenDeals: 200,
      categories: ['Gaming'],
      keywords: ['deal'],
      gamingSources: {
        gamerpower: true,
        epicbundle: false,
      },
    });
    assert.deepStrictEqual(config.appriseUrls, ['discord://2/saved']);
    assert.strictEqual(config.pollIntervalMs, 90000);
    assert.strictEqual(config.minVotes, 10);
    assert.strictEqual(config.maxSeenDeals, 200);
    assert.deepStrictEqual(config.categories, ['Gaming']);
    assert.deepStrictEqual(config.keywords, ['deal']);
    assert.strictEqual(config.gamingSources.gamerpower, true);
    assert.strictEqual(config.gamingSources.epicbundle, false);
  });

  it('gaming sources default to false', async () => {
    process.env.APPRISE_URLS = 'discord://1/abc';
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(null);
    assert.strictEqual(config.gamingSources.gamerpower, false);
    assert.strictEqual(config.gamingSources.epicbundle, false);
    assert.strictEqual(config.gamingSources.gamerpowerGames, false);
    assert.strictEqual(config.gamingSources.gamerpowerLoot, false);
  });

  it('gaming sources from env vars', async () => {
    process.env.APPRISE_URLS = 'discord://1/abc';
    process.env.GAMERPOWER_ENABLED = 'true';
    process.env.EPICBUNDLE_ENABLED = 'true';
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(null);
    assert.strictEqual(config.gamingSources.gamerpower, true);
    assert.strictEqual(config.gamingSources.epicbundle, true);
    delete process.env.GAMERPOWER_ENABLED;
    delete process.env.EPICBUNDLE_ENABLED;
  });
});
