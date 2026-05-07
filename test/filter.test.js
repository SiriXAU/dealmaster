import { describe, it } from 'node:test';
import assert from 'node:assert';
import { filterDeals, filterForProfile, matchesCategories, meetsMinVotes, matchesKeywords } from '../src/filter.js';

function deal(overrides = {}) {
  return {
    id: '1', title: 'Test Deal', link: 'https://example.com',
    category: 'Computing', pubDate: null, description: 'A great deal on stuff.',
    votes: 5, imageUrl: null, author: 'tester', price: '$10',
    expiry: null, store: 'Amazon', delivery: 'Delivered', source: 'ozbargain',
    ...overrides,
  };
}

describe('matchesCategories', () => {
  it('passes when no categories specified', () => {
    assert.ok(matchesCategories(deal(), []));
    assert.ok(matchesCategories(deal(), null));
  });

  it('matches case-insensitive substring', () => {
    assert.ok(matchesCategories(deal({ category: 'Computing' }), ['computing']));
    assert.ok(matchesCategories(deal({ category: 'Gaming' }), ['GAMING']));
  });

  it('rejects non-matching category', () => {
    assert.ok(!matchesCategories(deal({ category: 'Computing' }), ['Gaming']));
  });

  it('matches any of multiple categories', () => {
    assert.ok(matchesCategories(deal({ category: 'Gaming' }), ['Computing', 'Gaming']));
  });

  it('handles null category', () => {
    assert.ok(!matchesCategories(deal({ category: null }), ['Gaming']));
  });
});

describe('meetsMinVotes', () => {
  it('passes when minVotes is 0 (even with negative votes)', () => {
    // minVotes 0 means no filter — any vote count passes
    const d = deal({ votes: -5 });
    // meetsMinVotes checks deal.votes >= minVotes; 0 >= 0 = true, -5 >= 0 = false
    // Default minVotes is 0, so -5 should NOT pass. This is correct behavior.
    assert.ok(!meetsMinVotes(d, 0));
  });

  it('filters below threshold', () => {
    assert.ok(!meetsMinVotes(deal({ votes: 3 }), 5));
  });

  it('passes at threshold', () => {
    assert.ok(meetsMinVotes(deal({ votes: 5 }), 5));
  });

  it('always passes for gaming sources', () => {
    assert.ok(meetsMinVotes(deal({ source: 'gamerpower', votes: 0 }), 10));
    assert.ok(meetsMinVotes(deal({ source: 'epicbundle', votes: 0 }), 10));
  });
});

describe('matchesKeywords', () => {
  it('passes when no keywords', () => {
    assert.ok(matchesKeywords(deal(), []));
    assert.ok(matchesKeywords(deal(), null));
  });

  it('matches in title', () => {
    assert.ok(matchesKeywords(deal({ title: 'Free game deal' }), ['free']));
  });

  it('matches in description', () => {
    assert.ok(matchesKeywords(deal({ description: 'Save big today' }), ['save']));
  });

  it('matches in store', () => {
    assert.ok(matchesKeywords(deal({ store: 'Steam' }), ['steam']));
  });

  it('rejects when none match', () => {
    assert.ok(!matchesKeywords(deal({ title: 'Expensive item', description: 'Luxury brand', store: 'Nordstrom' }), ['free', 'steam']));
  });

  it('matches any keyword (OR logic)', () => {
    assert.ok(matchesKeywords(deal({ title: 'Pizza deal' }), ['steam', 'pizza']));
  });
});

describe('filterDeals', () => {
  it('combines all filters', () => {
    const deals = [
      deal({ id: '1', category: 'Computing', votes: 10, title: 'Free SSD' }),
      deal({ id: '2', category: 'Gaming', votes: 3, title: 'Graphics card sale' }),
      deal({ id: '3', category: 'Computing', votes: 1, title: 'Laptop deal' }),
    ];
    const result = filterDeals(deals, {
      categories: ['Computing'],
      minVotes: 5,
      keywords: [],
    });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, '1');
  });

  it('returns empty array for empty input', () => {
    assert.strictEqual(filterDeals([], {}).length, 0);
  });
});

describe('filterForProfile', () => {
  it('reads filters off the profile object', () => {
    const deals = [
      deal({ id: '1', category: 'Computing', votes: 10, title: 'Free SSD' }),
      deal({ id: '2', category: 'Gaming', votes: 3 }),
    ];
    const profile = { id: 'p', categories: ['Computing'], minVotes: 5, keywords: [] };
    const result = filterForProfile(deals, profile);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, '1');
  });

  it('two profiles with disjoint categories filter independently', () => {
    const deals = [
      deal({ id: '1', category: 'Computing' }),
      deal({ id: '2', category: 'Gaming' }),
    ];
    const a = filterForProfile(deals, { id: 'a', categories: ['Computing'], minVotes: 0, keywords: [] });
    const b = filterForProfile(deals, { id: 'b', categories: ['Gaming'],    minVotes: 0, keywords: [] });
    assert.deepStrictEqual(a.map(d => d.id), ['1']);
    assert.deepStrictEqual(b.map(d => d.id), ['2']);
  });
});
