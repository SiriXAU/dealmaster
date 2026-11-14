import fs from 'fs/promises';
import path from 'path';

let counter = 0;

/**
 * Writes a file atomically: the data goes to a temp file in the same directory
 * which is then renamed over the target. A crash or full disk mid-write leaves
 * the previous file intact instead of a truncated / corrupt one.
 */
export async function writeFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${counter++}.tmp`);
  try {
    await fs.writeFile(tmpPath, data, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
