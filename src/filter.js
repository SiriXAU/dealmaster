/**
 * Returns deals that match the given criteria.
 * Backward-compatible: callers that pass `{ categories, keywords, minVotes }`
 * (the legacy global-filter shape) still work; new callers can pass a profile.
 */
export function filterDeals(deals, criteria) {
  const { categories, minVotes, keywords } = criteria ?? {};
  return deals.filter(deal =>
    matchesCategories(deal, categories) &&
    meetsMinVotes(deal, minVotes) &&
    matchesKeywords(deal, keywords)
  );
}

/**
 * Returns deals that match a profile's filters.
 * Same predicate set as filterDeals but reads off a profile object.
 */
export function filterForProfile(deals, profile) {
  return filterDeals(deals, {
    categories: profile?.categories,
    minVotes:   profile?.minVotes,
    keywords:   profile?.keywords,
  });
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
  // Gaming sources don't use a voting system — always pass the votes filter
  if (deal.source !== 'ozbargain') return true;
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
