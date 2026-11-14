import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';
import { writeFileAtomic } from './fsUtil.js';

const log = createLogger('history');

const MAX_HISTORY = 50;

/**
 * Loads notification history from disk.
 * @param {string} dataDir
 * @returns {Promise<Array>}
 */
export async function loadHistory(dataDir) {
  const filePath = path.join(dataDir, 'history.json');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch {
    // File missing or corrupt — start fresh
  }
  return [];
}

/**
 * Prepends one or more notified deals to the history and persists once.
 * Never throws — history is informational, so failures are only logged.
 * @param {string} dataDir
 * @param {Object|Object[]} deals - Normalized deal object(s), oldest first
 */
export async function addToHistory(dataDir, deals) {
  const list = Array.isArray(deals) ? deals : [deals];
  if (list.length === 0) return;
  try {
    const history = await loadHistory(dataDir);
    const notifiedAt = new Date().toISOString();
    for (const deal of list) {
      history.unshift({
        title: deal.title,
        link: deal.link,
        category: deal.category,
        price: deal.price,
        store: deal.store,
        source: deal.source,
        notifiedAt,
      });
    }
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    await writeFileAtomic(path.join(dataDir, 'history.json'), JSON.stringify(history));
  } catch (err) {
    log.error(`Failed to save history: ${err.message}`);
  }
}
