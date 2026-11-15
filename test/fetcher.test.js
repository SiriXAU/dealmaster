import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeOzbItem, normalizeGamerPowerItem, isRetryableError, stripHtml } from '../src/fetcher.js';

describe('normalizeOzbItem', () => {
  function makeItem(overrides = {}) {
    return {
      guid: 'https://www.ozbargain.com.au/node/12345',
      title: 'Samsung SSD 1TB $99 @ Amazon',
      link: 'https://www.ozbargain.com.au/node/12345',
      pubDate: '2026-05-01T10:00:00.000Z',
      categories: ['Computing'],
      contentEncoded: '<p>Great deal on SSDs.</p>',
      creator: 'dealposter',
      ozbMeta: {
        $: { votes: '25', price: '$99', image: 'https://example.com/img.jpg' },
      },
      ...overrides,
    };
  }

  it('extracts basic fields', () => {
    const r = normalizeOzbItem(makeItem());
    assert.strictEqual(r.id, 'https://www.ozbargain.com.au/node/12345');
    assert.strictEqual(r.title, 'Samsung SSD 1TB $99 @ Amazon');
    assert.strictEqual(r.source, 'ozbargain');
    assert.strictEqual(r.votes, 25);
    assert.strictEqual(r.price, '$99');
  });

  it('extracts store from title', () => {
    const r = normalizeOzbItem(makeItem({ title: 'Deal title @ Amazon US' }));
    assert.strictEqual(r.store, 'Amazon US');
  });

  it('extracts delivery methods', () => {
    const r = normalizeOzbItem(makeItem({ title: 'Free delivery SSD deal @ Store' }));
    assert.ok(r.delivery.includes('Free Shipping'));
  });

  it('extracts price from title when meta missing', () => {
    const r = normalizeOzbItem(makeItem({
      ozbMeta: { $: {} },
      title: 'Samsung SSD $149.99 @ Amazon',
    }));
    assert.strictEqual(r.price, '$149.99');
  });

  it('handles missing fields gracefully', () => {
    const r = normalizeOzbItem({});
    assert.strictEqual(r.title, 'Unknown Deal');
    assert.strictEqual(r.votes, 0);
    assert.strictEqual(r.category, 'Uncategorised');
    assert.strictEqual(r.source, 'ozbargain');
  });

  it('strips HTML from description', () => {
    const r = normalizeOzbItem(makeItem({ contentEncoded: '<p>Test <b>deal</b> description</p>' }));
    assert.strictEqual(r.description, 'Test deal description');
  });
});

describe('normalizeGamerPowerItem', () => {
  function makeItem(overrides = {}) {
    return {
      id: 123,
      title: 'Free Game Giveaway',
      open_giveaway_url: 'https://www.gamerpower.com/123',
      published_date: '2026-05-01',
      description: 'Get a free game.',
      thumbnail: 'https://example.com/thumb.jpg',
      worth: 'N/A',
      end_date: 'N/A',
      ...overrides,
    };
  }

  it('normalizes gamerpower fields', () => {
    const r = normalizeGamerPowerItem(makeItem(), 'gamerpower');
    assert.strictEqual(r.id, 'gamerpower:123');
    assert.strictEqual(r.title, 'Free Game Giveaway');
    assert.strictEqual(r.source, 'gamerpower');
    assert.strictEqual(r.type, 'Freebie');
    assert.strictEqual(r.price, 'Free');
  });

  it('handles N/A worth and end_date', () => {
    const r = normalizeGamerPowerItem(makeItem(), 'gamerpower');
    assert.strictEqual(r.price, 'Free');
    assert.strictEqual(r.expiry, null);
  });

  it('uses real worth value', () => {
    const r = normalizeGamerPowerItem(makeItem({ worth: '$19.99' }), 'gamerpower');
    assert.strictEqual(r.price, '$19.99');
  });

  it('uses real end_date', () => {
    const r = normalizeGamerPowerItem(makeItem({ end_date: '2026-06-01' }), 'gamerpower');
    assert.strictEqual(r.expiry, '2026-06-01');
  });
});

describe('normalizeOzbItem vote attributes', () => {
  it('reads OzBargain votes-pos', () => {
    const r = normalizeOzbItem({
      guid: 'g', title: 'X $1 @ Y', link: 'l', categories: ['Computing'],
      ozbMeta: { $: { 'votes-pos': '42', 'votes-neg': '3', expiry: '2026-12-01' } },
    });
    assert.strictEqual(r.votes, 42);
    assert.strictEqual(r.expiry, '2026-12-01');
  });
});

describe('isRetryableError', () => {
  it('retries rss-parser status and timeout errors', () => {
    assert.ok(isRetryableError(new Error('Status code 503')));
    assert.ok(isRetryableError(new Error('Status code 429')));
    assert.ok(isRetryableError(new Error('Request timed out after 15000ms')));
  });
  it('retries fetch failures, timeouts and our own HTTP errors', () => {
    assert.ok(isRetryableError(new Error('HTTP 502')));
    assert.ok(isRetryableError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })));
    assert.ok(isRetryableError(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
  });
  it('does not retry client errors or programming bugs', () => {
    assert.ok(!isRetryableError(new Error('Status code 404')));
    assert.ok(!isRetryableError(new Error('HTTP 403')));
    assert.ok(!isRetryableError(new TypeError("Cannot read properties of undefined (reading 'map')")));
  });
});

describe('stripHtml', () => {
  it('decodes entities in a single pass', () => {
    assert.strictEqual(stripHtml('<p>a &amp;lt; b</p>'), 'a &lt; b');
  });
  it('decodes numeric entities', () => {
    assert.strictEqual(stripHtml('It&#8217;s &#x27;free&#x27;'), 'It’s \'free\'');
  });
  it('leaves unknown entities alone', () => {
    assert.strictEqual(stripHtml('&bogus; &lt;b&gt;'), '&bogus; <b>');
  });
});
