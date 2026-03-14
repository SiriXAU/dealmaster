import { execFile } from 'child_process';

/**
 * Sends a notification for a single deal via the Apprise CLI.
 *
 * @param {Object} deal - Normalized deal object
 * @param {Object} config - App config (appriseUrls)
 * @returns {Promise<boolean>} true on success
 */
export async function sendDealNotification(deal, config) {
  const title = buildTitle(deal);
  const body = buildBody(deal);
  return runApprise(title, body, config.appriseUrls);
}

/**
 * Builds a notification title for the given deal.
 */
function buildTitle(deal) {
  return truncate(deal.title, 250);
}

/**
 * Builds a markdown notification body for the given deal.
 */
function buildBody(deal) {
  const description = truncate(deal.description, 300) || 'No description available.';
  const category = deal.category || 'Uncategorised';
  const votes = String(deal.votes);
  const author = deal.author || 'Unknown';
  const link = deal.link || '';

  return `${description}\n\nCategory: ${category} | Votes: ${votes} | By: ${author}\n${link}`;
}

/**
 * Invokes the apprise CLI to send a notification to all configured URLs.
 *
 * @param {string} title
 * @param {string} body
 * @param {string[]} urls
 * @returns {Promise<boolean>}
 */
function runApprise(title, body, urls) {
  return new Promise(resolve => {
    execFile(
      'apprise',
      ['--title', title, '--body', body, '--input-format', 'markdown', ...urls],
      (err, stdout, stderr) => {
        if (err) {
          console.error(`[notifier] Apprise exited with code ${err.code}: ${stderr}`);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

/**
 * Truncates a string to maxLen characters, appending '…' if truncated.
 */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Waits for the given number of milliseconds.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
