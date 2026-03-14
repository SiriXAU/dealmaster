/**
 * Loads and validates configuration from environment variables.
 */
export function loadConfig() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('ERROR: DISCORD_WEBHOOK_URL environment variable is required.');
    console.error('Set it to your Discord webhook URL, e.g.:');
    console.error('  docker run -e DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." dealmaster');
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
  const discordUsername = process.env.DISCORD_USERNAME ?? 'OzBargain Deals';
  const dataDir = process.env.DATA_DIR ?? '/data';
  const redditEnabled = (process.env.REDDIT_ENABLED ?? 'true').toLowerCase() !== 'false';

  return Object.freeze({
    webhookUrl,
    categories,
    pollIntervalMs: pollIntervalSeconds * 1000,
    minVotes: isNaN(minVotes) ? 0 : minVotes,
    maxSeenDeals: isNaN(maxSeenDeals) ? 500 : maxSeenDeals,
    discordUsername,
    dataDir,
    redditEnabled,
  });
}
