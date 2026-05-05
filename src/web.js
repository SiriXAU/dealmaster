import http from 'node:http';
import { createLogger } from './logger.js';

const log = createLogger('web');

const MAX_BODY = 65_536; // 64 KB

function validateSettings(body) {
  if (body == null || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object' };
  }

  if (!Array.isArray(body.appriseUrls)) {
    return { error: 'appriseUrls must be an array', field: 'appriseUrls' };
  }
  for (const u of body.appriseUrls) {
    if (typeof u !== 'string' || u.trim().length === 0) {
      return { error: 'Each apprise URL must be a non-empty string', field: 'appriseUrls' };
    }
  }

  if (body.pollIntervalSeconds != null) {
    const n = Number(body.pollIntervalSeconds);
    if (!Number.isInteger(n) || n < 30) {
      return { error: 'pollIntervalSeconds must be an integer >= 30', field: 'pollIntervalSeconds' };
    }
  }

  if (body.minVotes != null) {
    const n = Number(body.minVotes);
    if (!Number.isInteger(n) || n < 0) {
      return { error: 'minVotes must be an integer >= 0', field: 'minVotes' };
    }
  }

  if (body.maxSeenDeals != null) {
    const n = Number(body.maxSeenDeals);
    if (!Number.isInteger(n) || n < 1) {
      return { error: 'maxSeenDeals must be an integer >= 1', field: 'maxSeenDeals' };
    }
  }

  if (body.categories != null) {
    if (!Array.isArray(body.categories)) {
      return { error: 'categories must be an array', field: 'categories' };
    }
    for (const c of body.categories) {
      if (typeof c !== 'string') {
        return { error: 'Each category must be a string', field: 'categories' };
      }
    }
  }

  if (body.keywords != null) {
    if (!Array.isArray(body.keywords)) {
      return { error: 'keywords must be an array', field: 'keywords' };
    }
    for (const k of body.keywords) {
      if (typeof k !== 'string') {
        return { error: 'Each keyword must be a string', field: 'keywords' };
      }
    }
  }

  if (body.gamingSources != null) {
    if (typeof body.gamingSources !== 'object' || Array.isArray(body.gamingSources)) {
      return { error: 'gamingSources must be an object', field: 'gamingSources' };
    }
    for (const [key, val] of Object.entries(body.gamingSources)) {
      if (typeof val !== 'boolean') {
        return { error: `gamingSources.${key} must be a boolean`, field: 'gamingSources' };
      }
    }
  }

  return null;
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
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

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>dealmaster &middot; settings</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'media',
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] }
        }
      }
    }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    body { background: #f4f4f5; }
    @media (prefers-color-scheme: dark) { body { background: #18181b; } }

    input:focus, textarea:focus {
      outline: none;
      box-shadow: 0 0 0 3px rgba(255,102,0,0.18);
      border-color: #FF6600 !important;
    }
    .save-btn { background: #FF6600; }
    .save-btn:hover  { background: #e65c00; }
    .save-btn:active { background: #cc5200; }
    .save-btn:disabled { background: #aaa; cursor: not-allowed; }

    input[type=number]::-webkit-inner-spin-button { opacity: 0.4; }

    [data-chip][data-active="true"]  { background:#FF6600; color:#fff; border-color:#FF6600; }
    [data-chip][data-active="false"] { background:#fff; color:#3f3f46; border-color:#e4e4e7; }
    @media (prefers-color-scheme: dark) {
      [data-chip][data-active="false"] { background:#3f3f46; color:#d4d4d8; border-color:#52525b; }
    }

    /* ── Tabs ─────────────────────────────────────────────────────────── */
    .tab-bar { display: flex; gap: 0; border-bottom: 1px solid #e4e4e7; }
    @media (prefers-color-scheme: dark) { .tab-bar { border-color: #3f3f46; } }
    .tab-btn {
      flex: 1; padding: 10px 16px; font-size: 13px; font-weight: 500;
      border: none; background: none; cursor: pointer;
      color: #71717a; border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }
    .tab-btn:hover { color: #3f3f46; }
    @media (prefers-color-scheme: dark) { .tab-btn:hover { color: #d4d4d8; } }
    .tab-btn.active { color: #FF6600; border-bottom-color: #FF6600; }

    /* ── Deal cards ───────────────────────────────────────────────────── */
    .deal-card {
      display: flex; flex-direction: column; gap: 6px;
      padding: 14px 16px;
      border-bottom: 1px solid #f4f4f5;
      transition: background 0.1s;
    }
    @media (prefers-color-scheme: dark) { .deal-card { border-color: #27272a; } }
    .deal-card:hover { background: #fafafa; }
    @media (prefers-color-scheme: dark) { .deal-card:hover { background: #27272a; } }

    .deal-title {
      font-size: 13px; font-weight: 500; line-height: 1.4;
      color: #18181b; text-decoration: none;
    }
    .deal-title:hover { color: #FF6600; }
    @media (prefers-color-scheme: dark) { .deal-title { color: #f4f4f5; } }

    .deal-meta {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      font-size: 11px; color: #71717a;
    }
    @media (prefers-color-scheme: dark) { .deal-meta { color: #a1a1aa; } }

    .source-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }

    .filter-badge {
      font-size: 10px; padding: 2px 7px; border-radius: 9999px;
      font-weight: 500; white-space: nowrap;
    }
    .filter-badge.ok { background: #dcfce7; color: #166534; }
    .filter-badge.skip { background: #f4f4f5; color: #71717a; }
    @media (prefers-color-scheme: dark) {
      .filter-badge.ok { background: #14532d; color: #86efac; }
      .filter-badge.skip { background: #27272a; color: #a1a1aa; }
    }

    .deals-empty { text-align: center; padding: 48px 16px; color: #a1a1aa; font-size: 13px; }
    .deals-empty svg { width: 40px; height: 40px; margin: 0 auto 12px; opacity: 0.3; }
  </style>
</head>
<body class="min-h-screen font-sans text-zinc-900 dark:text-zinc-100 antialiased">

  <header class="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700/60 sticky top-0 z-20">
    <div class="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style="background:#FF6600">
          <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
          </svg>
        </div>
        <span class="font-semibold text-[15px] tracking-tight">dealmaster</span>
        <span class="text-zinc-300 dark:text-zinc-600 text-sm">&middot;</span>
        <span class="text-sm text-zinc-500 dark:text-zinc-400">settings</span>
      </div>
      <div class="hidden sm:flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <span id="status-dot" class="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 inline-block"></span>
        <span id="status-text">Connecting&hellip;</span>
      </div>
      <div class="flex sm:hidden items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <span id="status-dot-sm" class="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 inline-block"></span>
        <span id="status-text-sm">…</span>
      </div>
    </div>
  </header>

  <div class="max-w-2xl mx-auto">
    <nav class="tab-bar px-6">
      <button class="tab-btn active" data-tab="settings">Settings</button>
      <button class="tab-btn" data-tab="deals">Recent Deals <span id="deal-count" class="text-zinc-400 text-xs">(-)</span></button>
    </nav>
  </div>

  <!-- Settings panel -->
  <main id="panel-settings" class="max-w-2xl mx-auto px-6 py-8 space-y-4">

    <!-- Success banner -->
    <div id="banner-success" class="hidden items-center gap-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 rounded-xl px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
      <svg class="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
      </svg>
      Settings saved &amp; poll loop restarted
      <span id="banner-time" class="ml-auto text-emerald-600 dark:text-emerald-500 text-xs whitespace-nowrap"></span>
    </div>

    <!-- Error banner -->
    <div id="banner-error" class="hidden items-center gap-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/70 rounded-xl px-4 py-3 text-sm text-red-800 dark:text-red-300">
      <svg class="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      </svg>
      <span id="banner-error-msg">An error occurred.</span>
    </div>

    <!-- Notification URLs -->
    <div class="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
      <div class="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-700/60">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-sm font-semibold">Notification URLs</h2>
            <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">One Apprise URL per line. Supports Discord, Slack, Telegram, email &amp; 100+ more.</p>
          </div>
          <a href="https://github.com/caronc/apprise/wiki" target="_blank" rel="noopener" class="text-xs text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300 mt-0.5 shrink-0">Apprise docs &#8599;</a>
        </div>
      </div>
      <div class="px-5 py-4">
        <textarea
          id="apprise-urls"
          rows="4"
          class="w-full font-mono text-xs bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3.5 py-3 resize-none placeholder-zinc-400 dark:placeholder-zinc-600 transition-colors"
          placeholder="discord://YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN&#10;slack://TokenA/TokenB/TokenC/Channel"
        ></textarea>
        <div id="url-indicator" class="flex items-center gap-2 mt-2 min-h-[1.25rem]"></div>
      </div>
    </div>

    <!-- Categories -->
    <div class="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
      <div class="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-700/60">
        <h2 class="text-sm font-semibold">Deal Categories</h2>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Leave blank to receive all categories. Matching is case-insensitive substring.</p>
      </div>
      <div class="px-5 py-4 space-y-3">
        <div id="chips" class="flex flex-wrap gap-1.5">
          <button type="button" data-chip="Computing"             class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Computing</button>
          <button type="button" data-chip="Gaming"                class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Gaming</button>
          <button type="button" data-chip="Consumer Electronics"  class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Consumer Electronics</button>
          <button type="button" data-chip="Home &amp; Garden"     class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Home &amp; Garden</button>
          <button type="button" data-chip="Food &amp; Drink"      class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Food &amp; Drink</button>
          <button type="button" data-chip="Travel"                class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Travel</button>
          <button type="button" data-chip="Health &amp; Beauty"   class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Health &amp; Beauty</button>
          <button type="button" data-chip="Clothing"              class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Clothing</button>
          <button type="button" data-chip="Automotive"            class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Automotive</button>
          <button type="button" data-chip="Mobile Phones"         class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Mobile Phones</button>
          <button type="button" data-chip="Entertainment"         class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Entertainment</button>
          <button type="button" data-chip="Sports &amp; Outdoors" class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Sports &amp; Outdoors</button>
        </div>
        <input
          id="categories-input"
          type="text"
          class="w-full text-sm bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3.5 py-2.5 placeholder-zinc-400 dark:placeholder-zinc-600 transition-colors"
          placeholder="Or type custom categories, comma-separated&hellip;"
        />
      </div>
    </div>

    <!-- Keywords -->
    <div class="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
      <div class="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-700/60">
        <h2 class="text-sm font-semibold">Keyword Filter</h2>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Only notify for deals whose title, description, or store matches at least one keyword. Leave blank to receive all deals.</p>
      </div>
      <div class="px-5 py-4 space-y-3">
        <div id="keyword-chips" class="flex flex-wrap gap-1.5">
          <button type="button" data-chip="Free"         class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Free</button>
          <button type="button" data-chip="Steam"        class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Steam</button>
          <button type="button" data-chip="Epic Games"   class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Epic Games</button>
          <button type="button" data-chip="PlayStation"  class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">PlayStation</button>
          <button type="button" data-chip="Xbox"         class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Xbox</button>
          <button type="button" data-chip="Nintendo"     class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Nintendo</button>
          <button type="button" data-chip="Amazon"       class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Amazon</button>
          <button type="button" data-chip="Cashback"     class="text-xs font-medium px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none">Cashback</button>
        </div>
        <input
          id="keywords-input"
          type="text"
          class="w-full text-sm bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3.5 py-2.5 placeholder-zinc-400 dark:placeholder-zinc-600 transition-colors"
          placeholder="Or type custom keywords, comma-separated&hellip;"
        />
      </div>
    </div>

    <!-- Gaming Sources -->
    <div class="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
      <div class="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-700/60">
        <h2 class="text-sm font-semibold">Gaming Sources</h2>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Optional dedicated gaming deal feeds. All disabled by default.</p>
      </div>
      <div class="px-5 py-2 divide-y divide-zinc-100 dark:divide-zinc-700/60">

        <div class="flex items-center justify-between py-3.5">
          <div>
            <div class="text-sm font-medium text-zinc-700 dark:text-zinc-300">GamerPower <span class="text-xs font-normal text-zinc-400 dark:text-zinc-500 ml-1">gamerpower.com/rss/giveaways</span></div>
            <div class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">All free game giveaways &amp; freebies</div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
            <input type="checkbox" id="toggle-gamerpower" class="sr-only peer" />
            <div class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer peer-checked:bg-orange-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
          </label>
        </div>

        <div class="flex items-center justify-between py-3.5">
          <div>
            <div class="text-sm font-medium text-zinc-700 dark:text-zinc-300">GamerPower · Games <span class="text-xs font-normal text-zinc-400 dark:text-zinc-500 ml-1">gamerpower.com/rss/games</span></div>
            <div class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Full free games only (no loot or DLC)</div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
            <input type="checkbox" id="toggle-gamerpower-games" class="sr-only peer" />
            <div class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer peer-checked:bg-orange-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
          </label>
        </div>

        <div class="flex items-center justify-between py-3.5">
          <div>
            <div class="text-sm font-medium text-zinc-700 dark:text-zinc-300">GamerPower · Loot <span class="text-xs font-normal text-zinc-400 dark:text-zinc-500 ml-1">gamerpower.com/rss/loot</span></div>
            <div class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">In-game loot, DLC &amp; bonus content only</div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
            <input type="checkbox" id="toggle-gamerpower-loot" class="sr-only peer" />
            <div class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer peer-checked:bg-orange-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
          </label>
        </div>

        <div class="flex items-center justify-between py-3.5">
          <div>
            <div class="text-sm font-medium text-zinc-700 dark:text-zinc-300">EpicBundle <span class="text-xs font-normal text-zinc-400 dark:text-zinc-500 ml-1">epicbundle.com/feed</span></div>
            <div class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Game bundles &amp; big promotional offers</div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
            <input type="checkbox" id="toggle-epicbundle" class="sr-only peer" />
            <div class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer peer-checked:bg-orange-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
          </label>
        </div>

      </div>
    </div>

    <!-- Polling + Filtering -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">

      <div class="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
        <div class="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-700/60">
          <h2 class="text-sm font-semibold">Polling</h2>
          <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">How often to check OzBargain.</p>
        </div>
        <div class="px-5 py-4">
          <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">Interval (seconds)</label>
          <input
            id="poll-interval"
            type="number" min="30"
            class="w-full text-sm bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3.5 py-2.5 transition-colors"
          />
          <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Minimum 30s</p>
        </div>
      </div>

      <div class="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
        <div class="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-700/60">
          <h2 class="text-sm font-semibold">Filtering</h2>
          <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Quality thresholds for deals.</p>
        </div>
        <div class="px-5 py-4 space-y-3">
          <div>
            <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">Minimum votes</label>
            <input
              id="min-votes"
              type="number" min="0"
              class="w-full text-sm bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3.5 py-2.5 transition-colors"
            />
          </div>
          <div>
            <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">Max seen deals</label>
            <input
              id="max-seen"
              type="number" min="1"
              class="w-full text-sm bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3.5 py-2.5 transition-colors"
            />
            <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Memory cap for deduplication</p>
          </div>
        </div>
      </div>

    </div>

    <!-- Save row -->
    <div class="flex items-center justify-between pt-1 pb-4">
      <p class="text-xs text-zinc-400 dark:text-zinc-500">Changes take effect immediately — no restart needed.</p>
      <button id="save-btn" class="save-btn text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors shadow-sm">
        Save settings
      </button>
    </div>

  </main>

  <!-- Recent Deals panel -->
  <div id="panel-deals" class="max-w-2xl mx-auto px-6 py-6 hidden">
    <div class="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
      <div id="deals-list"></div>
      <div id="deals-pagination" style="display:none" class="flex items-center justify-between px-4 py-3 border-t border-zinc-100 dark:border-zinc-700/60">
        <button id="prev-page" class="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">&larr; Prev</button>
        <span id="page-info" class="text-xs text-zinc-400 dark:text-zinc-500"></span>
        <button id="next-page" class="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next &rarr;</button>
      </div>
      <div id="deals-empty" class="deals-empty hidden">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
        </svg>
        <p>No deals in the last 24 hours</p>
        <p class="text-xs mt-1">Deals will appear here after the first poll cycle.</p>
      </div>
    </div>
    <p class="text-xs text-zinc-300 dark:text-zinc-600 text-center mt-4">Showing deals from the last 24 hours</p>
  </div>

  <div id="panel-settings-footer" class="max-w-2xl mx-auto px-6 pb-8">
    <p class="text-xs text-zinc-300 dark:text-zinc-600 text-center">dealmaster &middot; settings</p>
  </div>

  <script>
    const chipsEl      = document.getElementById('chips');
    const catInput     = document.getElementById('categories-input');
    const kwChipsEl    = document.getElementById('keyword-chips');
    const kwInput      = document.getElementById('keywords-input');
    const appriseEl    = document.getElementById('apprise-urls');
    const pollEl       = document.getElementById('poll-interval');
    const minVotesEl   = document.getElementById('min-votes');
    const maxSeenEl    = document.getElementById('max-seen');
    const toggleGamerpower      = document.getElementById('toggle-gamerpower');
    const toggleGamerpowerGames = document.getElementById('toggle-gamerpower-games');
    const toggleGamerpowerLoot  = document.getElementById('toggle-gamerpower-loot');
    const toggleEpicbundle      = document.getElementById('toggle-epicbundle');
    const saveBtn      = document.getElementById('save-btn');
    const urlIndicator = document.getElementById('url-indicator');
    const bannerOk     = document.getElementById('banner-success');
    const bannerErr    = document.getElementById('banner-error');
    const bannerErrMsg = document.getElementById('banner-error-msg');
    const bannerTime   = document.getElementById('banner-time');
    const statusDot    = document.getElementById('status-dot');
    const statusText   = document.getElementById('status-text');
    const statusDotSm  = document.getElementById('status-dot-sm');
    const statusTextSm = document.getElementById('status-text-sm');

    // ── Chips ──────────────────────────────────────────────────────────────
    function getSelected() {
      return new Set(catInput.value.split(',').map(function(v){ return v.trim().toLowerCase(); }).filter(Boolean));
    }
    function renderChips() {
      var selected = getSelected();
      chipsEl.querySelectorAll('[data-chip]').forEach(function(chip) {
        chip.dataset.active = selected.has(chip.dataset.chip.toLowerCase()) ? 'true' : 'false';
      });
    }
    chipsEl.addEventListener('click', function(e) {
      var chip = e.target.closest('[data-chip]');
      if (!chip) return;
      var label  = chip.dataset.chip;
      var values = catInput.value.split(',').map(function(v){ return v.trim(); }).filter(Boolean);
      var idx    = values.findIndex(function(v){ return v.toLowerCase() === label.toLowerCase(); });
      if (idx === -1) values.push(label); else values.splice(idx, 1);
      catInput.value = values.join(', ');
      renderChips();
    });
    catInput.addEventListener('input', renderChips);

    // ── Keyword chips ─────────────────────────────────────────────────────
    function getSelectedKeywords() {
      return new Set(kwInput.value.split(',').map(function(v){ return v.trim().toLowerCase(); }).filter(Boolean));
    }
    function renderKeywordChips() {
      var selected = getSelectedKeywords();
      kwChipsEl.querySelectorAll('[data-chip]').forEach(function(chip) {
        chip.dataset.active = selected.has(chip.dataset.chip.toLowerCase()) ? 'true' : 'false';
      });
    }
    kwChipsEl.addEventListener('click', function(e) {
      var chip = e.target.closest('[data-chip]');
      if (!chip) return;
      var label  = chip.dataset.chip;
      var values = kwInput.value.split(',').map(function(v){ return v.trim(); }).filter(Boolean);
      var idx    = values.findIndex(function(v){ return v.toLowerCase() === label.toLowerCase(); });
      if (idx === -1) values.push(label); else values.splice(idx, 1);
      kwInput.value = values.join(', ');
      renderKeywordChips();
    });
    kwInput.addEventListener('input', renderKeywordChips);

    // ── URL indicator ─────────────────────────────────────────────────────
    function updateUrlIndicator() {
      var lines = appriseEl.value.split('\\n').map(function(l){ return l.trim(); }).filter(Boolean);
      if (lines.length === 0) { urlIndicator.innerHTML = ''; return; }
      var types = [];
      var hasDiscord  = lines.some(function(l){ return l.toLowerCase().startsWith('discord://'); });
      var hasSlack    = lines.some(function(l){ return l.toLowerCase().startsWith('slack://'); });
      var hasTelegram = lines.some(function(l){ return l.toLowerCase().startsWith('tgram://'); });
      var hasEmail    = lines.some(function(l){ return l.toLowerCase().startsWith('mailto:'); });
      if (hasDiscord)  types.push('<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-indigo-400 inline-block"></span>Discord</span>');
      if (hasSlack)    types.push('<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-green-400 inline-block"></span>Slack</span>');
      if (hasTelegram) types.push('<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-sky-400 inline-block"></span>Telegram</span>');
      if (hasEmail)    types.push('<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>Email</span>');
      var other = lines.filter(function(l){
        var ll = l.toLowerCase();
        return !ll.startsWith('discord://') && !ll.startsWith('slack://') && !ll.startsWith('tgram://') && !ll.startsWith('mailto:');
      }).length;
      if (other > 0) types.push('<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-zinc-400 inline-block"></span>' + other + ' other</span>');
      urlIndicator.innerHTML = '<span class="flex flex-wrap gap-3 text-xs text-zinc-400 dark:text-zinc-500">' + types.join('') + '</span>';
    }
    appriseEl.addEventListener('input', updateUrlIndicator);

    // ── Status bar ────────────────────────────────────────────────────────
    function setStatus(running, intervalSeconds) {
      var dot   = running ? 'bg-emerald-400' : 'bg-zinc-300 dark:bg-zinc-600';
      var label = running ? 'Running · polling every ' + intervalSeconds + 's' : 'Stopped';
      var sm    = running ? 'Running' : 'Stopped';
      statusDot.className    = 'w-1.5 h-1.5 rounded-full inline-block ' + dot;
      statusDotSm.className  = 'w-2 h-2 rounded-full inline-block ' + dot;
      statusText.textContent = label;
      statusTextSm.textContent = sm;
    }

    // ── Banners ───────────────────────────────────────────────────────────
    function showSuccess(savedAt) {
      var t = savedAt ? new Date(savedAt).toLocaleTimeString() : '';
      bannerTime.textContent = t ? 'Saved · ' + t : '';
      bannerOk.classList.remove('hidden');
      bannerOk.classList.add('flex');
      bannerErr.classList.add('hidden');
      bannerErr.classList.remove('flex');
    }
    function showError(msg) {
      bannerErrMsg.textContent = msg || 'An error occurred.';
      bannerErr.classList.remove('hidden');
      bannerErr.classList.add('flex');
      bannerOk.classList.add('hidden');
      bannerOk.classList.remove('flex');
    }
    function hideBanners() {
      bannerOk.classList.add('hidden');  bannerOk.classList.remove('flex');
      bannerErr.classList.add('hidden'); bannerErr.classList.remove('flex');
    }

    // ── Populate form from API ────────────────────────────────────────────
    function populateForm(data) {
      appriseEl.value   = (data.appriseUrls || []).join('\\n');
      catInput.value    = (data.categories  || []).join(', ');
      kwInput.value     = (data.keywords    || []).join(', ');
      pollEl.value      = data.pollIntervalSeconds != null ? data.pollIntervalSeconds : 120;
      minVotesEl.value  = data.minVotes     != null ? data.minVotes     : 0;
      maxSeenEl.value   = data.maxSeenDeals != null ? data.maxSeenDeals : 500;
      var gs = data.gamingSources || {};
      toggleGamerpower.checked      = Boolean(gs.gamerpower);
      toggleGamerpowerGames.checked = Boolean(gs.gamerpowerGames);
      toggleGamerpowerLoot.checked  = Boolean(gs.gamerpowerLoot);
      toggleEpicbundle.checked      = Boolean(gs.epicbundle);
      renderChips();
      renderKeywordChips();
      updateUrlIndicator();
      setStatus(true, data.pollIntervalSeconds || 120);
      if (data.savedAt && !data.fromEnv) {
        bannerTime.textContent = 'Last saved · ' + new Date(data.savedAt).toLocaleString();
        bannerOk.classList.remove('hidden');
        bannerOk.classList.add('flex');
      }
    }

    fetch('/api/settings')
      .then(function(r){ return r.json(); })
      .then(populateForm)
      .catch(function(){ setStatus(false, 0); });

    // ── Save ──────────────────────────────────────────────────────────────
    saveBtn.addEventListener('click', function() {
      hideBanners();

      var urls = appriseEl.value.split('\\n').map(function(u){ return u.trim(); }).filter(Boolean);
      if (urls.length === 0) {
        showError('At least one notification URL is required.');
        appriseEl.focus();
        return;
      }
      var interval = parseInt(pollEl.value, 10);
      if (isNaN(interval) || interval < 30) {
        showError('Poll interval must be 30 seconds or more.');
        pollEl.focus();
        return;
      }

      var payload = {
        appriseUrls:         urls,
        categories:          catInput.value.split(',').map(function(v){ return v.trim(); }).filter(Boolean),
        keywords:            kwInput.value.split(',').map(function(v){ return v.trim(); }).filter(Boolean),
        pollIntervalSeconds: interval,
        minVotes:            parseInt(minVotesEl.value,  10) || 0,
        maxSeenDeals:        parseInt(maxSeenEl.value,   10) || 500,
        gamingSources: {
          gamerpower:      toggleGamerpower.checked,
          gamerpowerGames: toggleGamerpowerGames.checked,
          gamerpowerLoot:  toggleGamerpowerLoot.checked,
          epicbundle:      toggleEpicbundle.checked,
        },
      };

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      fetch('/api/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
        .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); })
        .then(function(result) {
          if (result.ok) {
            showSuccess(result.data.savedAt);
            setStatus(true, payload.pollIntervalSeconds);
          } else {
            showError(result.data.error || 'Save failed.');
          }
        })
        .catch(function(){ showError('Network error — could not reach server.'); })
        .finally(function() {
          saveBtn.disabled    = false;
          saveBtn.textContent = 'Save settings';
        });
    });

    // ── Tab switching ──────────────────────────────────────────────────────
    var tabBtns        = document.querySelectorAll('[data-tab]');
    var panelSettings  = document.getElementById('panel-settings');
    var panelDeals     = document.getElementById('panel-deals');
    var panelFooter    = document.getElementById('panel-settings-footer');
    var dealCount      = document.getElementById('deal-count');
    var dealsList      = document.getElementById('deals-list');
    var dealsEmpty     = document.getElementById('deals-empty');
    var dealsPagination = document.getElementById('deals-pagination');
    var prevPage       = document.getElementById('prev-page');
    var nextPage       = document.getElementById('next-page');
    var pageInfo       = document.getElementById('page-info');
    var PAGE_LIMIT     = 20;
    var currentPage    = 1;
    var cachedDeals    = [];

    tabBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tab = this.dataset.tab;
        tabBtns.forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        if (tab === 'settings') {
          panelSettings.classList.remove('hidden');
          panelDeals.classList.add('hidden');
          panelFooter.classList.remove('hidden');
        } else {
          panelSettings.classList.add('hidden');
          panelDeals.classList.remove('hidden');
          panelFooter.classList.add('hidden');
          loadDeals();
        }
      });
    });

    // ── Relative time ─────────────────────────────────────────────────────
    function timeAgo(iso) {
      var then = new Date(iso).getTime();
      var diff = Date.now() - then;
      var sec  = Math.floor(diff / 1000);
      if (sec < 60) return 'just now';
      var min = Math.floor(sec / 60);
      if (min < 60) return min + ' min ago';
      var hrs = Math.floor(min / 60);
      if (hrs < 24) return hrs + ' hour' + (hrs > 1 ? 's' : '') + ' ago';
      var days = Math.floor(hrs / 24);
      return days + ' day' + (days > 1 ? 's' : '') + ' ago';
    }

    // ── Source helpers ────────────────────────────────────────────────────
    var SOURCE_COLORS = {
      ozbargain: '#FF6600',
      gamerpower: '#EF4444',
      'gamerpower-games': '#EF4444',
      'gamerpower-loot': '#EF4444',
      epicbundle: '#8B5CF6',
    };

    function sourceName(source) {
      var map = {
        ozbargain: 'OzBargain',
        gamerpower: 'GamerPower',
        'gamerpower-games': 'GamerPower·Games',
        'gamerpower-loot': 'GamerPower·Loot',
        epicbundle: 'EpicBundle',
      };
      return map[source] || source || 'Unknown';
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeAttr(s) {
      return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Render deals ──────────────────────────────────────────────────────
    function buildDealHtml(d) {
      var dot   = SOURCE_COLORS[d.source] || '#a1a1aa';
      var badge = d.wasNotified
        ? '<span class="filter-badge ok">Notified</span>'
        : '<span class="filter-badge skip">Skipped' + (d.filterReason ? ': ' + escapeHtml(d.filterReason) : '') + '</span>';
      var title = d.title || 'Untitled';
      var link  = d.link || '';
      var titleHtml = link
        ? '<a class="deal-title" href="' + escapeAttr(link) + '" target="_blank" rel="noopener">' + escapeHtml(title) + '</a>'
        : '<span class="deal-title">' + escapeHtml(title) + '</span>';
      var meta = [];
      if (d.price) meta.push(d.price);
      if (d.store) meta.push(d.store);
      if (d.votes != null) meta.push('+' + d.votes + ' votes');
      return '<div class="deal-card">' +
        titleHtml +
        '<div class="deal-meta">' +
          '<span class="source-dot" style="background:' + dot + '"></span>' +
          '<span>' + sourceName(d.source) + '</span>' +
          (d.category ? '<span>' + escapeHtml(d.category) + '</span>' : '') +
          (meta.length ? '<span>' + meta.join(' \xb7 ') + '</span>' : '') +
          badge +
          '<span>' + timeAgo(d.fetchedAt) + '</span>' +
        '</div>' +
      '</div>';
    }

    function renderPage() {
      var deals = cachedDeals;
      if (!deals || deals.length === 0) {
        dealsList.innerHTML = '';
        dealsEmpty.classList.remove('hidden');
        dealsPagination.style.display = 'none';
        return;
      }
      dealsEmpty.classList.add('hidden');
      var totalPages = Math.ceil(deals.length / PAGE_LIMIT);
      var start = (currentPage - 1) * PAGE_LIMIT;
      dealsList.innerHTML = deals.slice(start, start + PAGE_LIMIT).map(buildDealHtml).join('');
      if (totalPages > 1) {
        dealsPagination.style.display = 'flex';
        pageInfo.textContent = 'Page ' + currentPage + ' of ' + totalPages + ' \xb7 ' + deals.length + ' in 24h';
        prevPage.disabled = currentPage <= 1;
        nextPage.disabled = currentPage >= totalPages;
      } else {
        dealsPagination.style.display = 'none';
      }
    }

    function renderDeals(deals) {
      cachedDeals = deals || [];
      currentPage = 1;
      dealCount.textContent = '(' + cachedDeals.length + ')';
      renderPage();
    }

    // ── Background deal-count polling (keeps tab badge live on Settings tab) ─
    function updateDealCount() {
      fetch('/api/deals/count')
        .then(function(r) { return r.json(); })
        .then(function(data) { dealCount.textContent = '(' + (data.count || 0) + ')'; })
        .catch(function() {});
    }
    updateDealCount();
    setInterval(updateDealCount, 60000);

    // ── Pagination buttons ────────────────────────────────────────────────
    prevPage.addEventListener('click', function() {
      if (currentPage > 1) { currentPage--; renderPage(); }
    });
    nextPage.addEventListener('click', function() {
      if (currentPage < Math.ceil(cachedDeals.length / PAGE_LIMIT)) { currentPage++; renderPage(); }
    });

    // ── Load deals from API ───────────────────────────────────────────────
    function loadDeals() {
      fetch('/api/deals')
        .then(function(r) { return r.json(); })
        .then(renderDeals)
        .catch(function() {
          dealsList.innerHTML = '';
          dealsEmpty.classList.remove('hidden');
          dealsEmpty.querySelector('p').textContent = 'Failed to load deals.';
          dealCount.textContent = '(-)';
        });
    }
  </script>

</body>
</html>`;

export function startWebServer({ port, getConfig, getMeta, getLastPollTime, getHistory, getDealLog, onSettingsSaved }) {
  const server = http.createServer(async (req, res) => {
    const { method, url } = req;

    try {
      if (method === 'GET' && url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML);
        return;
      }

      if (method === 'GET' && url === '/api/settings') {
        const config = getConfig();
        const meta   = getMeta();
        jsonResponse(res, 200, {
          appriseUrls:         config.appriseUrls,
          categories:          config.categories,
          keywords:            config.keywords,
          pollIntervalSeconds: config.pollIntervalMs / 1000,
          minVotes:            config.minVotes,
          maxSeenDeals:        config.maxSeenDeals,
          gamingSources:       config.gamingSources,
          savedAt:             meta.savedAt,
          fromEnv:             meta.savedAt === null,
        });
        return;
      }

      if (method === 'GET' && url === '/health') {
        const pollMs = getConfig().pollIntervalMs;
        const since = Date.now() - getLastPollTime();
        const healthy = since < pollMs * 3;
        jsonResponse(res, healthy ? 200 : 503, {
          healthy,
          lastPollMsAgo: since,
          pollIntervalMs: pollMs,
        });
        return;
      }

      if (method === 'GET' && url === '/api/history') {
        const history = await getHistory();
        jsonResponse(res, 200, history);
        return;
      }

      if (method === 'GET' && url === '/api/deals/count') {
        const deals = await getDealLog();
        jsonResponse(res, 200, { count: deals.length, notified: deals.filter(d => d.wasNotified).length });
        return;
      }

      if (method === 'GET' && url === '/api/deals') {
        const deals = await getDealLog();
        jsonResponse(res, 200, deals);
        return;
      }

      if (method === 'POST' && url === '/api/settings') {
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

        const validationError = validateSettings(body);
        if (validationError) {
          jsonResponse(res, 400, validationError);
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
    log.info(`Settings UI: http://localhost:${port}`);
  });

  return server;
}
