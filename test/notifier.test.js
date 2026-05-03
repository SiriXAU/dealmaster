import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseDiscordUrl, buildEmbed } from '../src/notifier.js';

describe('parseDiscordUrl', () => {
  it('parses discord:// URL', () => {
    const result = parseDiscordUrl('discord://123456/token_abc');
    assert.strictEqual(result, 'https://discord.com/api/webhooks/123456/token_abc');
  });

  it('parses with mixed format', () => {
    const result = parseDiscordUrl('discord://WEBHOOK_ID/WEB_HOOK_TOKEN');
    assert.strictEqual(result, 'https://discord.com/api/webhooks/WEBHOOK_ID/WEB_HOOK_TOKEN');
  });

  it('returns null for non-discord URLs', () => {
    assert.strictEqual(parseDiscordUrl('https://discord.com/webhook/123'), null);
    assert.strictEqual(parseDiscordUrl('tgram://token/chat'), null);
    assert.strictEqual(parseDiscordUrl(''), null);
  });

  it('returns null for discord URL with no path', () => {
    assert.strictEqual(parseDiscordUrl('discord://'), null);
  });
});

describe('buildEmbed', () => {
  function deal(overrides = {}) {
    return {
      id: '1', title: 'Test Deal', link: 'https://example.com',
      category: 'Computing', pubDate: '2026-05-01T10:00:00.000Z',
      description: 'A great deal.', votes: 25, imageUrl: 'https://example.com/img.jpg',
      author: 'tester', price: '$99', expiry: null,
      store: 'Amazon', delivery: 'Delivered', source: 'ozbargain',
      ...overrides,
    };
  }

  it('builds ozbargain embed with expected fields', () => {
    const embed = buildEmbed(deal());
    assert.strictEqual(embed.title, 'Test Deal');
    assert.strictEqual(embed.url, 'https://example.com');
    assert.strictEqual(embed.color, 0xFF6600);
    assert.ok(embed.thumbnail.url.startsWith('https://'));
    assert.strictEqual(embed.fields.length, 6); // 2 rows of 3
    assert.strictEqual(embed.fields[0].name, 'Price');
    assert.strictEqual(embed.fields[0].value, '$99');
    assert.strictEqual(embed.fields[3].name, 'Category');
    assert.strictEqual(embed.fields[4].name, 'Votes');
    assert.strictEqual(embed.fields[4].value, '25');
  });

  it('adds expiry field for ozbargain deals', () => {
    const embed = buildEmbed(deal({ expiry: '2026-12-31' }));
    const expiryField = embed.fields.find(f => f.name === 'Expires');
    assert.ok(expiryField);
    assert.ok(!expiryField.inline); // full-width
  });

  it('builds gaming embed with type/source fields', () => {
    const embed = buildEmbed(deal({
      source: 'gamerpower',
      type: 'Freebie',
      price: 'Free',
      delivery: null,
    }));
    assert.strictEqual(embed.color, 0xEF4444);
    assert.strictEqual(embed.fields.length, 6);
    assert.strictEqual(embed.fields[3].name, 'Type');
    assert.strictEqual(embed.fields[3].value, 'Freebie');
    assert.strictEqual(embed.fields[4].name, 'Source');
  });

  it('truncates long titles', () => {
    const longTitle = 'A'.repeat(300);
    const embed = buildEmbed(deal({ title: longTitle }));
    assert.strictEqual(embed.title.length, 256);
    assert.ok(embed.title.endsWith('…'));
  });

  it('handles missing link', () => {
    const embed = buildEmbed(deal({ link: '' }));
    assert.ok(!embed.url);
  });

  it('handles null imageUrl', () => {
    const embed = buildEmbed(deal({ imageUrl: null }));
    assert.ok(embed.thumbnail.url.startsWith('https://'));
  });
});
