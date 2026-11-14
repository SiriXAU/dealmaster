import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createLogger } from './logger.js';
import { normaliseSettings, defaultSchedule } from './settings.js';

const log = createLogger('web');

const MAX_BODY = 131_072; // 128 KB — profiles can stack up
const MASK = '••••';

const HTML = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

/**
 * Notification URLs carry webhook tokens / passwords, so the API never returns
 * them in full. Each URL is replaced with "scheme://••••<last4>"; when the UI
 * posts a masked value back unchanged it is swapped for the stored original.
 * If two stored URLs would mask identically, a short hash is used instead so
 * every mask maps back to exactly one URL.
 */
export function buildMaskMap(urls) {
  const unique = [...new Set(urls)];
  const simple = u => {
    const scheme = (String(u).match(/^([a-z0-9+.-]+):\/\//i) ?? [])[1] ?? 'url';
    return `${scheme}://${MASK}${String(u).slice(-4)}`;
  };
  const counts = new Map();
  for (const u of unique) counts.set(simple(u), (counts.get(simple(u)) ?? 0) + 1);

  const toMask = new Map();
  for (const u of unique) {
    let m = simple(u);
    if (counts.get(m) > 1) {
      const scheme = m.slice(0, m.indexOf('://'));
      m = `${scheme}://${MASK}${crypto.createHash('sha256').update(u).digest('hex').slice(0, 8)}`;
    }
    toMask.set(u, m);
  }
  const fromMask = new Map([...toMask].map(([u, m]) => [m, u]));
  return { toMask, fromMask };
}

/**
 * Replaces masked URLs in a submitted settings body with the stored originals.
 * Throws (with .field) if a masked value does not match any stored URL.
 */
export function unmaskSettings(body, currentUrls) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.profiles)) return body;
  const { fromMask } = buildMaskMap(currentUrls);
  return {
    ...body,
    profiles: body.profiles.map(p => {
      if (!p || typeof p !== 'object' || !Array.isArray(p.appriseUrls)) return p;
      return {
        ...p,
        appriseUrls: p.appriseUrls.map(u => {
          if (typeof u !== 'string' || !u.includes(MASK)) return u;
          const original = fromMask.get(u.trim());
          if (!original) {
            const e = new Error('A hidden notification URL no longer matches a saved one — please re-enter it in full.');
            e.field = 'profiles.appriseUrls';
            throw e;
          }
          return original;
        }),
      };
    }),
  };
}

function jsonResponse(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        const e = new Error('Payload too large');
        e.status = 413;
        reject(e);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Checks HTTP basic auth. Any username is accepted; only the password matters. */
function isAuthorised(req, password) {
  if (!password) return true;
  const header = req.headers.authorization ?? '';
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  return safeEqual(decoded.slice(idx + 1), password);
}

/**
 * Rejects cross-site state-changing requests. Browsers always send Origin on
 * cross-origin POSTs, so a request whose Origin does not match the Host it was
 * sent to (or an explicitly trusted origin) came from another website.
 */
function isSameOrigin(req, trustedOrigins) {
  const origin = req.headers.origin;
  if (!origin) {
    // Non-browser clients (curl, scripts) don't send Origin. Browsers that
    // omit it still send Sec-Fetch-Site, which we can check instead.
    const site = req.headers['sec-fetch-site'];
    return !site || site === 'same-origin' || site === 'none';
  }
  if (trustedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function parseList(s) {
  return String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);
}

export function startWebServer({
  port,
  getConfig,
  getMeta,
  getLastPollTime,
  getHistory,
  getDealLog,
  onSettingsSaved,
  password       = process.env.WEB_PASSWORD || null,
  trustedOrigins = parseList(process.env.WEB_TRUSTED_ORIGINS),
}) {
  const server = http.createServer(async (req, res) => {
    const { method } = req;
    const url = (req.url ?? '/').split('?')[0];

    try {
      // Health stays unauthenticated so container health checks keep working.
      if (method === 'GET' && url === '/health') {
        const pollMs = getConfig().pollIntervalMs;
        const since = Date.now() - getLastPollTime();
        const healthy = since < pollMs * 3;
        jsonResponse(res, healthy ? 200 : 503, { healthy, lastPollMsAgo: since, pollIntervalMs: pollMs });
        return;
      }

      if (!isAuthorised(req, password)) {
        jsonResponse(res, 401, { error: 'Authentication required' }, {
          'WWW-Authenticate': 'Basic realm="dealmaster", charset="UTF-8"',
        });
        return;
      }

      if (method === 'GET' && url === '/') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'same-origin',
        });
        res.end(HTML);
        return;
      }

      if (method === 'GET' && url === '/api/settings') {
        const config = getConfig();
        const meta   = getMeta();
        const { toMask } = buildMaskMap(config.profiles.flatMap(p => p.appriseUrls));
        jsonResponse(res, 200, {
          profiles: config.profiles.map(p => ({
            id: p.id,
            name: p.name,
            appriseUrls: p.appriseUrls.map(u => toMask.get(u)),
            categories: p.categories,
            keywords: p.keywords,
            minVotes: p.minVotes,
            schedule: p.schedule ?? defaultSchedule(),
          })),
          pollIntervalSeconds: config.pollIntervalMs / 1000,
          maxSeenDeals:        config.maxSeenDeals,
          gamingSources:       config.gamingSources,
          savedAt:             meta.savedAt,
          fromEnv:             meta.savedAt === null,
        });
        return;
      }

      if (method === 'GET' && url === '/api/history') {
        jsonResponse(res, 200, await getHistory());
        return;
      }

      if (method === 'GET' && url === '/api/deals/count') {
        const deals = await getDealLog();
        jsonResponse(res, 200, { count: deals.length, notified: deals.filter(d => d.wasNotified).length });
        return;
      }

      if (method === 'GET' && url === '/api/deals') {
        jsonResponse(res, 200, await getDealLog());
        return;
      }

      if (method === 'POST' && url === '/api/settings') {
        if (!isSameOrigin(req, trustedOrigins)) {
          jsonResponse(res, 403, { error: 'Cross-origin request rejected' });
          return;
        }
        const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (contentType !== 'application/json') {
          jsonResponse(res, 415, { error: 'Content-Type must be application/json' });
          return;
        }

        let raw;
        try {
          raw = await readBody(req);
        } catch (e) {
          jsonResponse(res, e.status === 413 ? 413 : 400, { error: e.message });
          return;
        }

        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          jsonResponse(res, 400, { error: 'Invalid JSON' });
          return;
        }

        try {
          body = unmaskSettings(body, getConfig().profiles.flatMap(p => p.appriseUrls));
          normaliseSettings(body);
        } catch (err) {
          jsonResponse(res, 400, { error: err.message, field: err.field ?? null });
          return;
        }

        try {
          const saved = await onSettingsSaved(body);
          jsonResponse(res, 200, { ok: true, savedAt: saved.savedAt });
        } catch (err) {
          jsonResponse(res, 400, { error: err.message, field: err.field ?? null });
        }
        return;
      }

      jsonResponse(res, 404, { error: 'Not found' });
    } catch (err) {
      log.error(`Unhandled error: ${err.message}`);
      if (!res.headersSent) jsonResponse(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(port, () => {
    const addr = server.address();
    log.info(`Settings UI: http://localhost:${addr?.port ?? port}${password ? ' (password protected)' : ''}`);
  });

  return server;
}
