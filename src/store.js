import fs from 'fs/promises';
import path from 'path';

/**
 * Loads the set of previously seen deal IDs from disk.
 * Returns an empty Set if the file doesn't exist or is corrupt.
 *
 * @param {string} dataDir - Directory where seen-deals.json lives
 * @returns {Promise<Set<string>>}
 */
export async function loadSeenIds(dataDir) {
  const filePath = path.join(dataDir, 'seen-deals.json');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const ids = JSON.parse(raw);
    if (Array.isArray(ids)) return new Set(ids);
  } catch {
    // File missing or corrupt — start fresh
  }
  return new Set();
}

/**
 * Persists the set of seen deal IDs to disk.
 * Trims the oldest entries if the set exceeds maxSize.
 *
 * @param {Set<string>} ids
 * @param {string} dataDir
 * @param {number} maxSize
 */
export async function saveSeenIds(ids, dataDir, maxSize) {
  await fs.mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, 'seen-deals.json');

  let arr = Array.from(ids);
  if (arr.length > maxSize) {
    // Keep the most recently added (tail of array)
    arr = arr.slice(arr.length - maxSize);
  }

  await fs.writeFile(filePath, JSON.stringify(arr), 'utf-8');
}
