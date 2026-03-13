/**
 * Filters deals by configured categories and minimum vote count.
 *
 * @param {Array} deals - Normalized deal objects from fetcher
 * @param {Object} opts
 * @param {string[]} opts.categories - Whitelist of category substrings (empty = all)
 * @param {number} opts.minVotes - Minimum votes required (0 = all)
 * @returns {Array} Filtered deals
 */
export function filterDeals(deals, { categories, minVotes }) {
  return deals.filter(deal => matchesCategories(deal, categories) && meetsMinVotes(deal, minVotes));
}

/**
 * Returns true if the deal's category matches the whitelist.
 * Empty whitelist passes all deals.
 * Matching is case-insensitive substring.
 */
export function matchesCategories(deal, categories) {
  if (!categories || categories.length === 0) return true;
  const dealCat = (deal.category ?? '').toLowerCase();
  return categories.some(c => dealCat.includes(c.toLowerCase()));
}

/**
 * Returns true if the deal has at least minVotes votes.
 */
export function meetsMinVotes(deal, minVotes) {
  return deal.votes >= (minVotes ?? 0);
}
