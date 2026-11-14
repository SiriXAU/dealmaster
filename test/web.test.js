import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { startWebServer, buildMaskMap, unmaskSettings } from '../src/web.js';

const URLS = ['discord://111/secret-token-abcd', 'tgram://bot:token/chat1234'];

function makeServer(opts = {}) {
  const savedBodies = [];
  const config = {
    profiles: [{
      id: 'default', name: 'Default', appriseUrls: URLS, categories: [], keywords: [], minVotes: 0,
      schedule: { timezone: 'UTC', mode: 'realtime', quietHours: [], digestAt: '08:00' },
    }],
    pollIntervalMs: 120_000,
    maxSeenDeals: 500,
    gamingSources: {},
  };
  const server = startWebServer({
    port: 0,
    getConfig: () => config,
    getMeta: () => ({ savedAt: null }),
    getLastPollTime: () => Date.now(),
    getHistory: async () => [],
    getDealLog: async () => [],
    onSettingsSaved: async (body) => { savedBodies.push(body); return { savedAt: 'now' }; },
    password: null,
    trustedOrigins: [],
    ...opts,
  });
  return { server, savedBodies };
}

function base(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function listening(server) {
  if (!server.listening) await new Promise(r => server.once('listening', r));
}

describe('URL masking', () => {
  it('masks every URL and maps masks back uniquely', () => {
    const urls = ['json://a/1234', 'json://b/1234', 'tgram://x/abcd'];
    const { toMask, fromMask } = buildMaskMap(urls);
    for (const u of urls) {
      assert.ok(!toMask.get(u).includes('/a/') && toMask.get(u).includes('••••'));
      assert.strictEqual(fromMask.get(toMask.get(u)), u);
    }
    assert.notStrictEqual(toMask.get(urls[0]), toMask.get(urls[1]));
  });

  it('rejects an unknown masked URL', () => {
    assert.throws(() => unmaskSettings({ profiles: [{ appriseUrls: ['json://••••zzzz'] }] }, URLS), /re-enter/);
  });
});

describe('web server', () => {
  let ctx;
  before(async () => { ctx = makeServer(); await listening(ctx.server); });
  after(() => ctx.server.close());

  it('never returns notification URLs in full', async () => {
    const res = await fetch(`${base(ctx.server)}/api/settings`);
    const body = await res.json();
    const text = JSON.stringify(body);
    assert.ok(!text.includes('secret-token'));
    assert.ok(!text.includes('bot:token'));
    assert.match(body.profiles[0].appriseUrls[0], /^discord:\/\/••••/);
  });

  it('restores masked URLs when they are posted back', async () => {
    const got = await (await fetch(`${base(ctx.server)}/api/settings`)).json();
    const res = await fetch(`${base(ctx.server)}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles: got.profiles, pollIntervalSeconds: 120, maxSeenDeals: 500 }),
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(ctx.savedBodies.at(-1).profiles[0].appriseUrls, URLS);
  });

  it('rejects non-JSON content types (CSRF via simple requests)', async () => {
    const res = await fetch(`${base(ctx.server)}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ profiles: [{ id: 'x', appriseUrls: ['json://evil'] }] }),
    });
    assert.strictEqual(res.status, 415);
  });

  it('rejects cross-origin POSTs', async () => {
    const res = await fetch(`${base(ctx.server)}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ profiles: [{ id: 'x', appriseUrls: ['json://evil'] }] }),
    });
    assert.strictEqual(res.status, 403);
  });

  it('rejects URLs that look like CLI options', async () => {
    const res = await fetch(`${base(ctx.server)}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles: [{ id: 'x', appriseUrls: ['--attach=/etc/passwd'] }] }),
    });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /must not start with "-"/);
  });

  it('rejects invalid timezones', async () => {
    const res = await fetch(`${base(ctx.server)}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles: [{ id: 'x', appriseUrls: ['json://a'], schedule: { timezone: 'Mars/Base' } }] }),
    });
    assert.strictEqual(res.status, 400);
  });
});

describe('web server with WEB_PASSWORD', () => {
  let ctx;
  before(async () => { ctx = makeServer({ password: 'hunter2' }); await listening(ctx.server); });
  after(() => ctx.server.close());

  it('requires auth for the UI and API', async () => {
    assert.strictEqual((await fetch(`${base(ctx.server)}/`)).status, 401);
    assert.strictEqual((await fetch(`${base(ctx.server)}/api/settings`)).status, 401);
  });

  it('accepts the right password with any username', async () => {
    const auth = 'Basic ' + Buffer.from('anyone:hunter2').toString('base64');
    assert.strictEqual((await fetch(`${base(ctx.server)}/api/settings`, { headers: { Authorization: auth } })).status, 200);
    const bad = 'Basic ' + Buffer.from('anyone:nope').toString('base64');
    assert.strictEqual((await fetch(`${base(ctx.server)}/api/settings`, { headers: { Authorization: bad } })).status, 401);
  });

  it('leaves /health open for container health checks', async () => {
    assert.strictEqual((await fetch(`${base(ctx.server)}/health`)).status, 200);
  });
});
