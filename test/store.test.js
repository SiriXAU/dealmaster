import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { contentHash, loadSeenDeals, saveSeenDeals } from '../src/store.js';

describe('contentHash', () => {
  it('returns a 16-char hex string', () => {
    const hash = contentHash({ title: 'Test', link: 'https://example.com', price: '$10' });
    assert.strictEqual(hash.length, 16);
    assert.ok(/^[a-f0-9]+$/.test(hash));
  });

  it('same content produces same hash', () => {
    const a = contentHash({ title: 'Test', link: 'https://a.com', price: '$10' });
    const b = contentHash({ title: 'Test', link: 'https://a.com', price: '$10' });
    assert.strictEqual(a, b);
  });

  it('different content produces different hash', () => {
    const a = contentHash({ title: 'A', link: 'https://a.com', price: '$10' });
    const b = contentHash({ title: 'B', link: 'https://a.com', price: '$10' });
    assert.notStrictEqual(a, b);
  });

  it('handles missing fields', () => {
    const hash = contentHash({});
    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 16);
  });
});

describe('loadSeenDeals / saveSeenDeals', () => {
  let tmpDir;

  // Clean/create temp dir before each test
  async function setup() {
    tmpDir = path.join(os.tmpdir(), `dealmaster-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tmpDir, { recursive: true });
  }

  async function cleanup() {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }

  it('returns empty state when no file exists', async () => {
    await setup();
    try {
      const { ids, hashes } = await loadSeenDeals(tmpDir);
      assert.strictEqual(ids.size, 0);
      assert.strictEqual(hashes.size, 0);
    } finally {
      await cleanup();
    }
  });

  it('saves and loads seen deals with hashes', async () => {
    await setup();
    try {
      const ids = new Set(['deal-1', 'deal-2']);
      const hashes = new Map([['abc123', Date.now()]]);
      await saveSeenDeals(ids, hashes, tmpDir, 500);

      const loaded = await loadSeenDeals(tmpDir);
      assert.ok(loaded.ids.has('deal-1'));
      assert.ok(loaded.ids.has('deal-2'));
      assert.strictEqual(loaded.hashes.get('abc123'), hashes.get('abc123'));
    } finally {
      await cleanup();
    }
  });

  it('trims old entries when exceeding maxSize', async () => {
    await setup();
    try {
      const ids = new Set();
      const hashes = new Map();
      for (let i = 0; i < 100; i++) {
        ids.add(`deal-${i}`);
        hashes.set(`hash-${i}`, Date.now() - (100 - i) * 1000);
      }
      await saveSeenDeals(ids, hashes, tmpDir, 50);

      const loaded = await loadSeenDeals(tmpDir);
      // IDs are kept from the tail
      assert.strictEqual(loaded.ids.size, 50);
      // Hashes are sorted by time, kept most recent
      assert.ok(loaded.hashes.size <= 50);
    } finally {
      await cleanup();
    }
  });

  it('handles corrupt file gracefully', async () => {
    await setup();
    try {
      await fs.writeFile(path.join(tmpDir, 'seen-deals.json'), 'not-json');
      const { ids, hashes } = await loadSeenDeals(tmpDir);
      assert.strictEqual(ids.size, 0);
      assert.strictEqual(hashes.size, 0);
    } finally {
      await cleanup();
    }
  });
});
