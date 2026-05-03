import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';

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
 * Appends a notified deal to the history and persists.
 * @param {string} dataDir
 * @param {Object} deal - Normalized deal object
 */
export async function addToHistory(dataDir, deal) {
  const history = await loadHistory(dataDir);
  history.unshift({
    title: deal.title,
    link: deal.link,
    category: deal.category,
    price: deal.price,
    store: deal.store,
    source: deal.source,
    notifiedAt: new Date().toISOString(),
  });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;

  const filePath = path.join(dataDir, 'history.json');
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(history), 'utf-8');
  } catch (err) {
    log.error(`Failed to save history: ${err.message}`);
  }
}
