import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadQueue, saveQueue, enqueue, drain, size } from '../src/digestQueue.js';

async function tmp() {
  const dir = path.join(os.tmpdir(), `dq-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('digestQueue', () => {
  it('round-trips a queue through save/load', async () => {
    const dir = await tmp();
    try {
      const q = new Map();
      enqueue(q, 'default', { id: 'a', title: 'Deal A' });
      enqueue(q, 'gaming',  { id: 'b', title: 'Deal B' });
      await saveQueue(dir, q);

      const loaded = await loadQueue(dir);
      assert.strictEqual(size(loaded, 'default'), 1);
      assert.strictEqual(size(loaded, 'gaming'),  1);
      assert.deepStrictEqual(drain(loaded, 'default').map(d => d.id), ['a']);
      assert.strictEqual(size(loaded, 'default'), 0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('drops oldest when over the per-profile cap', () => {
    const q = new Map();
    for (let i = 0; i < 60; i++) {
      enqueue(q, 'p', { id: String(i), title: `D${i}` });
    }
    assert.strictEqual(size(q, 'p'), 50);
    const drained = drain(q, 'p');
    // Oldest 10 should have been dropped.
    assert.strictEqual(drained[0].id, '10');
    assert.strictEqual(drained[drained.length - 1].id, '59');
  });

  it('returns an empty queue when no file exists', async () => {
    const dir = await tmp();
    try {
      const loaded = await loadQueue(dir);
      assert.strictEqual(loaded.size, 0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
