/**
 * Loads and validates configuration from environment variables.
 */
export function loadConfig() {
  const rawAppriseUrls = process.env.APPRISE_URLS ?? '';
  const appriseUrls = rawAppriseUrls
    .split(',')
    .map(u => u.trim())
    .filter(u => u.length > 0);

  if (appriseUrls.length === 0) {
    console.error('ERROR: APPRISE_URLS environment variable is required.');
    console.error('Set it to one or more Apprise notification URLs (comma-separated), e.g.:');
    console.error('  docker run -e APPRISE_URLS="discord://YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN" dealmaster');
    console.error('  See https://github.com/caronc/apprise/wiki for all supported services.');
    process.exit(1);
  }

  const pollIntervalSeconds = parseInt(process.env.POLL_INTERVAL_SECONDS ?? '120', 10);
  if (isNaN(pollIntervalSeconds) || pollIntervalSeconds < 30) {
    console.error('ERROR: POLL_INTERVAL_SECONDS must be a number >= 30');
    process.exit(1);
  }

  const rawCategories = process.env.CATEGORIES ?? '';
  const categories = rawCategories
    .split(',')
    .map(c => c.trim())
    .filter(c => c.length > 0);

  const minVotes = parseInt(process.env.MIN_VOTES ?? '0', 10);
  const maxSeenDeals = parseInt(process.env.MAX_SEEN_DEALS ?? '500', 10);
  const dataDir = process.env.DATA_DIR ?? '/data';

  return Object.freeze({
    appriseUrls,
    categories,
    pollIntervalMs: pollIntervalSeconds * 1000,
    minVotes: isNaN(minVotes) ? 0 : minVotes,
    maxSeenDeals: isNaN(maxSeenDeals) ? 500 : maxSeenDeals,
    dataDir,
  });
}
