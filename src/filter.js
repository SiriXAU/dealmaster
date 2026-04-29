export function filterDeals(deals, { categories, minVotes, keywords }) {
  return deals.filter(deal =>
    matchesCategories(deal, categories) &&
    meetsMinVotes(deal, minVotes) &&
    matchesKeywords(deal, keywords)
  );
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

export function meetsMinVotes(deal, minVotes) {
  return deal.votes >= (minVotes ?? 0);
}

/**
 * Returns true if any keyword appears in the deal's title, description, or store.
 * Empty keyword list passes all deals.
 * Matching is case-insensitive substring.
 */
export function matchesKeywords(deal, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const haystack = [deal.title, deal.description, deal.store]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return keywords.some(k => haystack.includes(k.toLowerCase()));
}
