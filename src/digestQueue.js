import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';

const log = createLogger('digest');

const FILE = 'pending-digest.json';
const MAX_PER_PROFILE = 50;

/**
 * Loads the per-profile pending-digest queue from disk.
 * Shape on disk: { "<profileId>": [{ deal, queuedAt }, ...] }
 *
 * @returns {Promise<Map<string, Array<{deal: object, queuedAt: number}>>>}
 */
export async function loadQueue(dataDir) {
  const filePath = path.join(dataDir, FILE);
  const map = new Map();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) map.set(k, v.filter(e => e && e.deal));
      }
    }
  } catch {
    // Missing or corrupt — start empty.
  }
  return map;
}

export async function saveQueue(dataDir, queue) {
  await fs.mkdir(dataDir, { recursive: true });
  const obj = Object.fromEntries(queue);
  await fs.writeFile(path.join(dataDir, FILE), JSON.stringify(obj), 'utf-8');
}

/**
 * Adds a deal to the queue for the given profile. Drops the oldest entries
 * (with a single warning log) when the per-profile cap is exceeded.
 */
export function enqueue(queue, profileId, deal, now = Date.now()) {
  const list = queue.get(profileId) ?? [];
  list.push({ deal, queuedAt: now });
  if (list.length > MAX_PER_PROFILE) {
    const dropped = list.length - MAX_PER_PROFILE;
    list.splice(0, dropped);
    log.warn(`Profile "${profileId}" digest queue exceeded ${MAX_PER_PROFILE}; dropped ${dropped} oldest deal(s)`);
  }
  queue.set(profileId, list);
}

/**
 * Removes and returns all queued deals for a profile.
 */
export function drain(queue, profileId) {
  const list = queue.get(profileId) ?? [];
  queue.delete(profileId);
  return list.map(e => e.deal);
}

export function size(queue, profileId) {
  return (queue.get(profileId) ?? []).length;
}
