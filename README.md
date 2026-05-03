# Dealmaster

> **Personal project notice:** Dealmaster was vibe-coded for personal use. It scratches a specific itch — getting OzBargain deal notifications directly in a notification service without relying on third-party bots or services. It works well for that purpose and is shared here in case it's useful to others, but comes with no guarantees, SLAs, or formal support. Use at your own risk and feel free to fork and adapt it.

Dealmaster monitors deal feeds and sends notifications via [Apprise](https://github.com/caronc/apprise), supporting 100+ services (Discord, Slack, Telegram, email, and more). It runs as a self-contained container with a built-in web settings interface — configure everything through the browser, no container restart required.

**Primary source:** [OzBargain](https://www.ozbargain.com.au/deals) — community deal posts with votes, categories, and store info.

**Optional gaming sources** (each independently toggled on/off):
- [GamerPower · Giveaways](https://www.gamerpower.com) — all free game giveaways and freebies
- [GamerPower · Games](https://www.gamerpower.com) — full free games only (no loot or DLC)
- [GamerPower · Loot](https://www.gamerpower.com) — in-game loot, DLC, and bonus content only
- [EpicBundle](https://epicbundle.com) — game bundles and big promotional offers

---

## Features

- Polls OzBargain RSS feed and optional gaming sources on a configurable interval
- **Optional gaming sources** — GamerPower (Giveaways, Games, and Loot as separate JSON API feeds) and EpicBundle (RSS) can each be toggled on/off independently from the web UI or via env vars
- Sends notifications via Apprise to any supported service (Discord, Slack, Telegram, email, and more)
- Discord URLs receive **rich embeds** — coloured card with source-specific branding, price, store, category, and relevant metadata
- **Web settings UI** — change any setting live at `http://localhost:8080`, dark mode and mobile-friendly
- **Input validation** — settings POST endpoint validates all fields and returns structured error responses
- Category, keyword, and minimum-vote filtering to reduce noise (gaming sources bypass the vote threshold)
- **Content-based deduplication** — prevents re-notification when a deal is reposted with a different ID (hashes title + link + price)
- Startup heartbeat — sends a notification for the most recent deal on launch so you know it's live
- Persistent seen-deal tracking and content hash store to prevent duplicate notifications across restarts
- **Notification history** — last 50 notified deals stored and viewable via `GET /api/history`
- **Recent Deals tab** — web UI tab showing all deals (notified and filtered) from the last 24 hours with filter reasons
- **Health endpoint** — `GET /health` returns JSON health status (200/503) based on poll cycle freshness
- Retry logic with exponential backoff on feed fetch failures (5xx, 429, network errors)
- Discord webhook rate limiting with `Retry-After` header handling
- **Structured logging** — timestamped, levelled log output; configurable via `LOG_LEVEL` env var
- Graceful shutdown on `SIGTERM`/`SIGINT` (plays well with `podman-compose down`)
- **Test suite** — 51 unit tests across filter, fetcher, config, notifier, and store modules; `npm test`

---

## Quick Start

No clone required. Create two files in a new directory and you're done.

**`docker-compose.yml`**
```yaml
services:
  dealmaster:
    image: ghcr.io/sirixau/dealmaster:latest
    restart: unless-stopped
    ports:
      - "${WEB_PORT:-8080}:8080"
    environment:
      - APPRISE_URLS=${APPRISE_URLS}
      - CATEGORIES=${CATEGORIES:-}
      - KEYWORDS=${KEYWORDS:-}
      - POLL_INTERVAL_SECONDS=${POLL_INTERVAL_SECONDS:-120}
      - MIN_VOTES=${MIN_VOTES:-0}
      - MAX_SEEN_DEALS=${MAX_SEEN_DEALS:-500}
      - LOG_LEVEL=${LOG_LEVEL:-info}
      # Optional gaming sources — remove or set to false to disable
      - GAMERPOWER_ENABLED=${GAMERPOWER_ENABLED:-false}
      - GAMERPOWER_GAMES_ENABLED=${GAMERPOWER_GAMES_ENABLED:-false}
      - GAMERPOWER_LOOT_ENABLED=${GAMERPOWER_LOOT_ENABLED:-false}
      - EPICBUNDLE_ENABLED=${EPICBUNDLE_ENABLED:-false}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/health').then(r=>r.json()).then(j=>{if(!j.healthy)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 60s
      timeout: 5s
      start_period: 30s
      retries: 3
    volumes:
      - dealmaster-data:/data

volumes:
  dealmaster-data:
```

**`.env`**
```
APPRISE_URLS=discord://YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
```

Then start it:
```bash
podman-compose up -d        # or: docker compose up -d
```

On first start, Dealmaster sends a notification for the most recent OzBargain deal so you know it's live, then begins watching for new ones. Open **http://localhost:8080** to configure settings via the web interface.

---

## Web Settings Interface

Dealmaster includes a built-in settings UI served on port 8080 inside the container. Open it in any browser — it works on desktop and mobile, and supports dark mode automatically.

![Settings UI showing notification URLs, category chips, polling and filtering controls](preview.html)

### What you can configure

| Setting | Description |
|---|---|
| **Notification URLs** | Add, remove, or update Apprise notification URLs — one per line |
| **Deal Categories** | Toggle OzBargain category chips or type custom filters |
| **Keyword Filter** | Only notify for deals whose title, description, or store matches a keyword |
| **Poll Interval** | How often to check all enabled feeds for new deals (minimum 30s) |
| **Minimum Votes** | Only notify for OzBargain deals with at least this many votes (gaming sources are unaffected) |
| **Max Seen Deals** | Memory cap for the deduplication store |
| **Gaming Sources** | Toggle GamerPower (Giveaways / Games / Loot) and EpicBundle on/off independently |

Changes take effect **immediately** — the poll loop restarts with the new settings without restarting the container.

### Recent Deals tab

The **Recent Deals** tab shows all deals fetched in the last 24 hours, including those that were filtered out. Each deal card displays:

- **Title** (linked to the deal page)
- **Source** with colour-coded dot (orange for OzBargain, red for GamerPower, purple for EpicBundle)
- **Price, store, votes, and category**
- **Filter status** — green "Notified" badge or grey "Skipped" badge with the reason (e.g. "below min votes: 3 < 5", "category mismatch", "already seen")
- **Relative timestamp** (e.g. "12 min ago", "2 hours ago")

This is useful for seeing what deals are being filtered and tuning your settings without checking multiple notification channels.

### Settings persistence

When you save via the web UI, settings are written to `$DATA_DIR/settings.json` (inside the data volume). On subsequent container restarts, this file takes precedence over all environment variables.

| Situation | Config source |
|---|---|
| First run, no `settings.json` | Environment variables (`.env`) |
| After first web UI save | `settings.json` — env vars are ignored |
| `settings.json` deleted | Falls back to environment variables |

> **Note:** If you update `.env` after saving via the web UI, the `.env` changes will be silently ignored — `settings.json` wins. To revert to env var values, delete `settings.json` from the data volume, or just update the values in the web UI instead.

To delete `settings.json` and revert to env vars:
```bash
# With Docker
docker exec <container-name> rm /data/settings.json

# Or bring the stack down and edit the volume directly
podman-compose down
podman run --rm -v dealmaster_dealmaster-data:/data alpine rm /data/settings.json
```

### Changing the web UI port

The container always listens on port **8080** internally. `WEB_PORT` controls which host port maps to it:

```
# .env
WEB_PORT=9000
```

With the above set, the UI is accessible at `http://localhost:9000` on the host while the container still binds internally to 8080.

### Restricting access

The web UI has no authentication. If you're running Dealmaster on a server rather than locally, use a reverse proxy (nginx, Caddy, Traefik) to restrict access or add basic auth. Alternatively, remove the `ports` binding from `docker-compose.yml` and access the UI via an SSH tunnel:

```bash
ssh -L 8080:localhost:8080 your-server
# then open http://localhost:8080
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | HTML settings UI |
| `GET` | `/api/settings` | Current configuration as JSON |
| `POST` | `/api/settings` | Save new configuration (validated, returns `{error, field}` on failure) |
| `GET` | `/api/history` | Last 50 notified deals as JSON array |
| `GET` | `/api/deals` | All deals from the last 24 hours with filter/notify status |
| `GET` | `/health` | Health status — `{"healthy":true,"lastPollMsAgo":…}` (200/503) |

---

## Environment Variables

These control initial configuration and serve as fallback values once the web UI has been used to save settings.

| Variable | Required | Default | Description |
|---|---|---|---|
| `APPRISE_URLS` | **Yes** (first run) | — | Comma-separated list of Apprise notification URLs |
| `CATEGORIES` | No | _(all)_ | Comma-separated category filter (see below) |
| `KEYWORDS` | No | _(all)_ | Comma-separated keyword filter — matches title, description, and store name |
| `POLL_INTERVAL_SECONDS` | No | `120` | Seconds between feed checks — minimum `30` |
| `MIN_VOTES` | No | `0` | Minimum OzBargain vote count required to notify (does not affect gaming sources) |
| `MAX_SEEN_DEALS` | No | `500` | Maximum deal IDs to retain in the persistence store |
| `LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, or `error` |
| `GAMERPOWER_ENABLED` | No | `false` | Set to `true` to enable the GamerPower all-giveaways feed |
| `GAMERPOWER_GAMES_ENABLED` | No | `false` | Set to `true` to enable the GamerPower full-games-only feed |
| `GAMERPOWER_LOOT_ENABLED` | No | `false` | Set to `true` to enable the GamerPower loot/DLC-only feed |
| `EPICBUNDLE_ENABLED` | No | `false` | Set to `true` to enable the EpicBundle feed |
| `DATA_DIR` | No | `/data` | Path for persistence files inside the container — not configurable via web UI |
| `WEB_PORT` | No | `8080` | Host port mapped to the web settings UI (container always listens on 8080 internally) |

`APPRISE_URLS` is required on the **first run only**. Once you've saved settings via the web UI, the container can start without it.

### Configuring Apprise URLs

`APPRISE_URLS` accepts one or more [Apprise](https://github.com/caronc/apprise)-format URLs, comma-separated. Apprise supports 100+ notification services.

| Service | Apprise URL format |
|---------|-------------------|
| Discord | `discord://webhook_id/webhook_token` |
| Slack | `slack://TokenA/TokenB/TokenC/Channel` |
| Telegram | `tgram://bottoken/ChatID` |
| Email (Gmail) | `mailto://user:pass@gmail.com` |
| Pushover | `pover://user@token` |
| Gotify | `gotify://hostname/token` |

> **Discord tip:** The webhook URL `https://discord.com/api/webhooks/1234/abcd` maps to `discord://1234/abcd`. Discord URLs receive **rich embeds** (coloured card with inline fields and thumbnail) sent directly via the webhook API — identical in appearance to the native Discord bot format. Discord notifications include per-webhook rate limiting (1s minimum interval) and automatic 429 retry handling. All other Apprise URLs receive a plain-text notification via the Apprise CLI.

See the [Apprise wiki](https://github.com/caronc/apprise/wiki) for all supported services and URL formats.

**Multiple services example:**
```
APPRISE_URLS=discord://id/token,slack://TokenA/TokenB/TokenC/Channel
```

> **Security note:** Treat your notification URLs as secrets — they grant posting access to your channels. Keep them out of version control — `.env` is in `.gitignore` for this reason.

---

## Category Filtering

Set `CATEGORIES` (via env var or the web UI) to a comma-separated list of terms to only receive deals in matching categories. Matching is **case-insensitive and substring-based**, so a single term can match several OzBargain category names.

| Filter term | Example categories matched |
|---|---|
| `Computing` | Computing, Consumer Electronics & Computers |
| `Gaming` | Gaming, PC Gaming |
| `Food` | Food & Drink, Groceries & Liquor |
| `Travel` | Travel, Accommodation & Travel |
| `Home` | Home & Garden, Home Appliances |
| `Electrical` | Electrical & Electronics |

Leave categories empty to receive all categories.

**Example `.env` for computing and gaming deals only:**
```
APPRISE_URLS=discord://YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
CATEGORIES=Computing,Gaming
MIN_VOTES=5
```

The same can be set (and changed live) via the web UI category chips.

---

## Keyword Filtering

Set `KEYWORDS` (via env var or the web UI) to a comma-separated list of terms to only receive deals that mention at least one of those keywords. The match searches the deal's **title**, **description body**, and **store name** — case-insensitive substring.

**Common use cases:**

| Keyword | What it catches |
|---|---|
| `Free` | Free games, free items, free shipping deals |
| `Steam` | Steam game sales and gifts |
| `Epic Games` | Epic Games Store deals and freebies |
| `PlayStation` | PS4/PS5 games, PlayStation Store deals |
| `Xbox` | Xbox game sales, Game Pass deals |
| `Nintendo` | Switch games and Nintendo eShop deals |
| `Cashback` | Cashback deals and promotions |

Leave `KEYWORDS` empty (the default) to receive all deals regardless of content.

**How keywords interact with categories:**

Both filters apply together — a deal must satisfy **all** active filters:

```
notify if:  matches_category  AND  matches_keyword  AND  meets_min_votes  AND  not_seen_before
```

So `CATEGORIES=Gaming` + `KEYWORDS=Free` will only notify for free deals in the Gaming category.

**Example `.env` for free games across any platform:**
```
APPRISE_URLS=discord://YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
KEYWORDS=Free,Steam,Epic Games
```

**Example `.env` for cheap computing deals with decent votes:**
```
APPRISE_URLS=discord://YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
CATEGORIES=Computing
KEYWORDS=SSD,GPU,CPU,RAM
MIN_VOTES=10
```

---

## Gaming Sources

Three optional gaming deal feeds can be enabled independently — from the web UI (Gaming Sources card) or via environment variables. All are disabled by default and have no effect on OzBargain behaviour when off.

| Source | API / Feed | Deal type | Discord colour |
|---|---|---|---|
| **GamerPower · Giveaways** | `gamerpower.com/api/giveaways` | All free game giveaways & freebies | Red |
| **GamerPower · Games** | `gamerpower.com/api/giveaways?type=game` | Full free games only (no loot or DLC) | Red |
| **GamerPower · Loot** | `gamerpower.com/api/giveaways?type=loot` | In-game loot, DLC & bonus content | Red |
| **EpicBundle** | `epicbundle.com/feed` | Game bundles & big promos | Purple |

### How gaming deals differ from OzBargain

| | OzBargain | Gaming sources |
|---|---|---|
| Votes | Community up/down vote count | Not applicable — always 0 |
| Minimum votes filter | Applied | Skipped (gaming deals always pass) |
| Discord embed fields | Price · Store · Delivery / Category · Votes · Posted by | Price · Store · Category / Type · Source · Posted |
| Embed branding | OzBargain orange | Source-specific colour and icon |
| Expiry | Shown when available | Not provided |
| Delivery method | Shown when present in title | Not applicable |

### Enabling via env var

```
# .env
GAMERPOWER_ENABLED=true
GAMERPOWER_GAMES_ENABLED=true
GAMERPOWER_LOOT_ENABLED=true
EPICBUNDLE_ENABLED=true
```

### Enabling via web UI

Open `http://localhost:8080`, scroll to the **Gaming Sources** card, and toggle the sources you want. Click **Save settings** — the poll loop restarts immediately and the new sources are included in the next cycle.

### Filtering with gaming sources active

- **Categories** — applies to gaming sources using the category field from each feed. Leave blank to receive all.
- **Keywords** — applies to gaming sources normally; useful for filtering by game name or platform.
- **Minimum votes** — ignored for gaming sources (they carry no vote data). Set it freely for OzBargain quality control without affecting gaming feeds.

### Startup behaviour with gaming sources

On startup, Dealmaster fetches all enabled sources in parallel and seeds their current items as seen — the same way it handles OzBargain. Only one startup notification is sent (the most recent deal across all enabled sources) to avoid flooding your channel.

---

## Startup Behaviour

On every start Dealmaster:

1. Loads configuration from `settings.json` (if it exists) or environment variables
2. Starts the web settings UI
3. Fetches the current feed from OzBargain and any enabled gaming sources (in parallel)
4. Sends a notification for the single most recent (filtered) deal across all sources as a liveness signal
5. Marks all current feed items and their content hashes as seen
6. Enters the regular poll loop

This means you always receive a startup notification confirming the tool is running, and the first real poll will only notify on deals that appear *after* that point.

---

## Persistence

Three files are stored in `$DATA_DIR` (default `/data`), persisted via the named Docker volume:

| File | Purpose |
|---|---|
| `settings.json` | Settings saved via the web UI — takes precedence over env vars on startup |
| `seen-deals.json` | Deal IDs and content hashes already notified — prevents duplicates across restarts |
| `history.json` | Last 50 notified deals with titles, links, sources, and timestamps |
| `deal-log.json` | All deals from the last 24 hours — notified and filtered — for the Recent Deals web UI tab |

The seen-deal store is capped at `MAX_SEEN_DEALS` entries (default: `500`). When the cap is reached, the oldest entries are trimmed. With a 2-minute poll interval and typical OzBargain posting volume this is more than enough to prevent duplicates indefinitely.

Content hashes (SHA-256 of title + link + price) provide a second layer of deduplication — if a deal is reposted with a different ID, it won't trigger a duplicate notification within a 24-hour window.

**Resetting seen deals** (to re-notify on all current deals):
```bash
podman-compose down
podman volume rm <project-directory>_dealmaster-data
podman-compose up -d
```

> The volume name is prefixed with the name of the directory containing your `docker-compose.yml`. For example, if your directory is `~/dealmaster`, the volume will be named `dealmaster_dealmaster-data`.

---

## Health Check

Dealmaster exposes a `GET /health` HTTP endpoint that returns the health status:

```json
{"healthy":true,"lastPollMsAgo":45000,"pollIntervalMs":120000}
```

A poll cycle is considered healthy if it completed within 3× the configured poll interval. The status code is `200` when healthy and `503` when stale.

The health check defined in `docker-compose.yml` calls this endpoint. If the poll loop stalls or crashes, the container will be marked unhealthy.

```bash
# Check health status (replace <container-name> with the actual container name)
podman inspect --format='{{.State.Health.Status}}' <container-name>

# List running containers to find the name
podman ps
```

Possible statuses: `starting` (within the 30s start period), `healthy`, `unhealthy`.

---

## Logging

Log output includes an ISO timestamp, severity level, and module name:

```
2026-05-03T10:30:00.000Z [INFO] [monitor] Poll loop started (interval: 120s)
2026-05-03T10:30:00.000Z [WARN] [fetcher] Retry 1/3 for epicbundle in 1000ms (HTTP 503)
```

Set `LOG_LEVEL` to control verbosity:

| Level | Shows |
|---|---|
| `debug` | Everything including retry attempts and detailed fetch info |
| `info` | Startup banner, poll cycles, new deal notifications, settings saves |
| `warn` | Transient errors, retries, rate limits |
| `error` | Fatal errors only |

The default is `info`.

---

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                          index.js                            │
│  Loads settings.json → loadConfig() → registers shutdown     │
│  → startWebServer() → startMonitor()                         │
└──────────┬────────────────────────────────┬──────────────────┘
           │                                │
┌──────────▼───────────┐        ┌───────────▼──────────────────┐
│      web.js          │        │         monitor.js            │
│  GET /               │        │  startMonitor() — heartbeat   │
│  GET /api/settings   │        │  + seed on startup            │
│  POST /api/settings  │        │  startPollLoop() — interval   │
│  GET /api/history    │        │  runOnce() — fetch→filter     │
│  GET /health         │        │  →dedupe→notify→persist       │
└──────────┬───────────┘        └──────┬────────────────────────┘
           │                           │
┌──────────▼───────────┐     ┌─────────▼──────────────────────┐  ┌─────────────────┐
│     settings.js      │     │          fetcher.js             │  │   notifier.js   │
│  load/save           │     │  fetchAllDeals(config)          │  │  Apprise CLI /  │
│  settings.json       │     │  ├─ OzBargain RSS (always)          │  │  Discord embed  │
└──────────────────────┘     │  ├─ gamerpower/giveaways (if ena.)  │  │  + rate limit   │
                             │  ├─ gamerpower/games   (if enabled) │  │  + 429 retry    │
                             │  ├─ gamerpower/loot    (if enabled) │  └─────────────────┘
                             │  └─ epicbundle.com    (if enabled)  │
                             └─────────┬──────────────────────────┘
                                       │ retry with backoff
                             ┌─────────▼──────┐
                             │   filter.js    │
                             │  category +    │
                             │  keyword +     │
                             │  vote filter   │
                             └─────────┬──────┘
                                       │
                             ┌─────────▼──────────┐
                             │     store.js       │
                             │  seen-deals.json   │
                             │  IDs + hash→ts     │
                             │  content dedup 24h │
                             └─────────┬──────────┘
                                       │
                             ┌─────────▼──────┐
                             │   history.js   │
                             │  history.json  │
                             │  last 50 deals │
                             └────────────────┘
```

1. `index.js` loads `settings.json` (if present) then builds config, starts the web UI, registers shutdown handlers, and calls `startMonitor()`
2. On startup, `monitor.js` fetches all enabled sources, sends a startup notification for the most recent deal, seeds all items and content hashes as seen, then starts the poll interval
3. On each poll, `fetcher.js` calls `fetchAllDeals(config)` which fetches OzBargain plus any enabled gaming sources **in parallel**, normalising each item into a consistent deal shape. Failed fetches are retried with exponential backoff (up to 3 attempts). GamerPower is fetched via their JSON API; EpicBundle uses RSS
4. `filter.js` applies the category whitelist and keyword filter to all sources; the minimum vote threshold is only applied to OzBargain deals
5. `store.js` loads the persisted set of seen deal IDs and content hashes, filters out already-seen deals and content-duplicate deals (within a 24h window)
6. `notifier.js` sends a notification for each new deal — Discord embeds use per-source branding with rate limiting (1s minimum interval, automatic 429 retry); all other URLs use the Apprise CLI
7. Newly seen IDs and content hashes are written back to disk, a history entry is appended, and `/tmp/health` is touched
8. When settings are saved via the web UI, `settings.js` validates and writes `settings.json`, the config is rebuilt, and the poll interval restarts with the new settings — no container restart needed

---

## Project Structure

```
dealmaster/
├── index.js              # Entry point — load settings, start web UI + monitor
├── src/
│   ├── config.js         # Config loading — settings.json → env var → default
│   ├── settings.js       # Load/save settings.json with validation
│   ├── web.js            # HTTP server — settings UI, /api/*, /health
│   ├── fetcher.js        # Feed fetching with retry — OzBargain RSS, GamerPower JSON API, EpicBundle RSS
│   ├── filter.js         # Category, keyword, and vote filtering
│   ├── monitor.js        # Poll loop, startup heartbeat, health tracking
│   ├── notifier.js       # Discord embed + Apprise CLI sender with rate limiting
│   ├── store.js          # Seen-deal + content-hash persistence (JSON on disk)
│   ├── history.js        # Notification history log (last 50 deals)
│   ├── dealLog.js        # Deal activity log — all deals, filtered + notified (24h window)
│   └── logger.js         # Structured logging with timestamps and levels
├── test/
│   ├── filter.test.js    # Filter unit tests
│   ├── fetcher.test.js   # Normalization unit tests
│   ├── config.test.js    # Config loading tests
│   ├── notifier.test.js  # Discord URL parsing + embed building tests
│   └── store.test.js     # Content hash + persistence tests
├── Dockerfile            # node:22-alpine image with Python3 + apprise
├── docker-compose.yml    # Compose definition with HTTP healthcheck and web port
├── .env.example          # Environment variable template
├── .gitignore
└── .dockerignore
```

---

## Development

```bash
# Install dependencies
npm install

# Run tests (51 tests across 5 suites)
npm test

# Run the app locally (needs APPRISE_URLS set)
APPRISE_URLS=discord://id/token node index.js

# Run with debug logging
LOG_LEVEL=debug APPRISE_URLS=discord://id/token node index.js
```

Node.js >= 18 is required.

---

## Requirements

- **Runtime:** Docker or Podman with Compose support (`docker compose` / `podman-compose`)
- **Notifications:** An Apprise-compatible notification service (Discord, Slack, Telegram, email, etc.)
- **Network:** Outbound HTTPS to `www.ozbargain.com.au` and your notification service endpoint(s). When gaming sources are enabled, also requires outbound HTTPS to `www.gamerpower.com` and/or `epicbundle.com`

No accounts, API keys, or external services beyond the above are required.
