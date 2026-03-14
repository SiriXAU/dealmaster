const BRAND = {
  color: 0xFF6600,
  iconUrl: 'https://www.ozbargain.com.au/sites/all/themes/ozbargain/logo-sm.png',
  footerText: 'OzBargain',
};

/**
 * Sends a Discord webhook notification for a single deal.
 *
 * @param {Object} deal - Normalized deal object
 * @param {Object} config - App config (webhookUrl, discordUsername)
 * @returns {Promise<boolean>} true on success
 */
export async function sendDealNotification(deal, config) {
  const embed = buildEmbed(deal);
  const payload = {
    username: config.discordUsername,
    avatar_url: BRAND.iconUrl,
    embeds: [embed],
  };

  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[notifier] Discord returned ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notifier] Failed to send notification: ${err.message}`);
    return false;
  }
}

/**
 * Builds a Discord embed object for the given deal.
 */
function buildEmbed(deal) {
  const title = truncate(deal.title, 256);
  const description = truncate(deal.description, 300) || 'No description available.';

  const fields = [
    { name: 'Category', value: deal.category || 'Uncategorised', inline: true },
    { name: 'Votes', value: String(deal.votes), inline: true },
    { name: 'Posted by', value: deal.author || 'Unknown', inline: true },
  ];

  const embed = {
    title,
    ...(deal.link ? { url: deal.link } : {}),
    description,
    color: BRAND.color,
    fields,
    footer: {
      text: BRAND.footerText,
      icon_url: BRAND.iconUrl,
    },
    timestamp: deal.pubDate ? new Date(deal.pubDate).toISOString() : new Date().toISOString(),
  };

  if (deal.imageUrl) {
    embed.thumbnail = { url: deal.imageUrl };
  }

  return embed;
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
