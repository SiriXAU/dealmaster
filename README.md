# Dealmaster

> **Personal project notice:** Dealmaster was vibe-coded for personal use. It scratches a specific itch — getting OzBargain deal notifications directly in a notification service without relying on third-party bots or services. It works well for that purpose and is shared here in case it's useful to others, but comes with no guarantees, SLAs, or formal support. Use at your own risk and feel free to fork and adapt it.

Dealmaster monitors deal feeds and sends notifications via [Apprise](https://github.com/caronc/apprise), supporting 100+ services (Discord, Slack, Telegram, email, and more). It runs as a self-contained container with a built-in web settings interface — configure everything through the browser, no container restart required.

**Primary source:** [OzBargain](https://www.ozbargain.com.au/deals) — community deal posts with votes, categories, and store info.

**Optional gaming sources** (each independently toggled on/off):
- [game-deals.app](https://game-deals.app) — all game deals, sales, and discounts
- [GamerPower](https://gamerpower.com) — free game giveaways and freebies
- [EpicBundle](https://epicbundle.com) — game bundles and big promotional offers

---

## Features

- Polls the OzBargain RSS feed on a configurable interval
- **Optional gaming sources** — Game Deals, GamerPower, and EpicBundle can each be toggled on/off independently from the web UI or via env vars
- Sends notifications via Apprise to any supported service (Discord, Slack, Telegram, email, and more)
- Discord URLs receive **rich embeds** — coloured card with source-specific branding, price, store, category, and relevant metadata
- **Web settings UI** — change any setting live at `http://localhost:8080`, dark mode and mobile-friendly
- Category, keyword, and minimum-vote filtering to reduce noise (gaming sources bypass the vote threshold since they don't use a voting system)
- Startup heartbeat — sends a notification for the most recent deal on launch so you know it's live
- Persistent seen-deal tracking to prevent duplicate notifications across restarts
- Graceful shutdown on `SIGTERM`/`SIGINT` (plays well with `podman-compose down`)
- Container health check via a polled timestamp file

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
      # Optional gaming sources — remove or set to false to disable
      - GAMING_DEALS_ENABLED=${GAMING_DEALS_ENABLED:-false}
      - GAMERPOWER_ENABLED=${GAMERPOWER_ENABLED:-false}
      - EPICBUNDLE_ENABLED=${EPICBUNDLE_ENABLED:-false}
    healthcheck:
      test: ["CMD", "node", "-e", "try{const s=require('fs').statSync('/tmp/health');if(Date.now()-s.mtimeMs>600000)process.exit(1);}catch(e){process.exit(1);}"]
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
| **Gaming Sources** | Toggle Game Deals, GamerPower, and EpicBundle on/off independently |

Changes take effect **immediately** — the poll loop restarts with the new settings without restarting the container.

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

## Environment Variables

These control initial configuration and serve as fallback values once the web UI has been used to save settings.

| Variable | Required | Default | Description |
|---|---|---|---|
| `APPRISE_URLS` | **Yes** (first run) | — | Comma-separated list of Apprise notification URLs |
| `CATEGORIES` | No | _(all)_ | Comma-separated category filter (see below) |
| `KEYWORDS` | No | _(all)_ | Comma-separated keyword filter — matches title, description, and store name (see below) |
| `POLL_INTERVAL_SECONDS` | No | `120` | Seconds between feed checks — minimum `30` |
| `MIN_VOTES` | No | `0` | Minimum OzBargain vote count required to notify (does not affect gaming sources) |
| `MAX_SEEN_DEALS` | No | `500` | Maximum deal IDs to retain in the persistence store |
| `GAMING_DEALS_ENABLED` | No | `false` | Set to `true` to enable the game-deals.app feed |
| `GAMERPOWER_ENABLED` | No | `false` | Set to `true` to enable the GamerPower freebies feed |
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

> **Discord tip:** The webhook URL `https://discord.com/api/webhooks/1234/abcd` maps to `discord://1234/abcd`. Discord URLs receive **rich embeds** (coloured card with inline fields and thumbnail) sent directly via the webhook API — identical in appearance to the native Discord bot format. All other Apprise URLs receive a plain-text notification via the Apprise CLI.

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
notify if:  matches_category  AND  matches_keyword  AND  meets_min_votes
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

| Source | Feed URL | Deal type | Discord colour |
|---|---|---|---|
| **Game Deals** | `game-deals.app/rss` | All game deals, sales & discounts | Green |
| **GamerPower** | `gamerpower.com/rss` | Free game giveaways & freebies | Red |
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
GAMING_DEALS_ENABLED=true
GAMERPOWER_ENABLED=true
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
5. Marks all current feed items as seen
6. Enters the regular poll loop

This means you always receive a startup notification confirming the tool is running, and the first real poll will only notify on deals that appear *after* that point.

---

## Persistence

Two files are stored in `$DATA_DIR` (default `/data`), persisted via the named Docker volume:

| File | Purpose |
|---|---|
| `seen-deals.json` | Set of deal IDs already notified — prevents duplicates across restarts |
| `settings.json` | Settings saved via the web UI — takes precedence over env vars on startup |

The seen-deal store is capped at `MAX_SEEN_DEALS` entries (default: `500`). When the cap is reached, the oldest entries are trimmed. With a 2-minute poll interval and typical OzBargain posting volume this is more than enough to prevent duplicates indefinitely.

**Resetting seen deals** (to re-notify on all current deals):
```bash
podman-compose down
podman volume rm <project-directory>_dealmaster-data
podman-compose up -d
```

> The volume name is prefixed with the name of the directory containing your `docker-compose.yml`. For example, if your directory is `~/dealmaster`, the volume will be named `dealmaster_dealmaster-data`.

---

## Health Check

After startup and after every poll cycle, Dealmaster writes a timestamp to `/tmp/health` inside the container. The health check defined in `docker-compose.yml` verifies that file has been updated within the last 10 minutes. If the poll loop stalls or crashes, the container will be marked unhealthy.

```bash
# Check health status (replace <container-name> with the actual container name)
podman inspect --format='{{.State.Health.Status}}' <container-name>

# List running containers to find the name
podman ps
```

Possible statuses: `starting` (within the 30s start period), `healthy`, `unhealthy`.

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
│  → restarts poll     │        │  runOnce() — fetch→filter     │
│    loop on save      │        │  →diff→notify→persist→health  │
└──────────┬───────────┘        └──────┬────────────────────────┘
           │                           │
┌──────────▼───────────┐     ┌─────────▼──────────────────────┐  ┌─────────────────┐
│     settings.js      │     │          fetcher.js             │  │   notifier.js   │
│  load/save           │     │  fetchAllDeals(config)          │  │  Apprise CLI /  │
│  settings.json       │     │  ├─ OzBargain RSS (always)      │  │  Discord embed  │
└──────────────────────┘     │  ├─ game-deals.app (if enabled) │  │  (per-source    │
                             │  ├─ gamerpower.com  (if enabled) │  │   branding)     │
                             │  └─ epicbundle.com  (if enabled) │  └─────────────────┘
                             └─────────┬──────────────────────┘
                                       │ parallel fetch, flat array
                             ┌─────────▼──────┐
                             │   filter.js    │
                             │  category +    │
                             │  keyword +     │
                             │  vote filter   │
                             │  (votes skipped│
                             │  for gaming)   │
                             └─────────┬──────┘
                                       │
                             ┌─────────▼──────┐
                             │    store.js    │
                             │  seen-deals    │
                             │  .json R/W     │
                             └────────────────┘
```

1. `index.js` loads `settings.json` (if present) then builds config, starts the web UI, registers shutdown handlers, and calls `startMonitor()`
2. On startup, `monitor.js` fetches all enabled sources, sends a startup notification for the most recent deal, marks everything as seen, then starts the poll interval
3. On each poll, `fetcher.js` calls `fetchAllDeals(config)` which fetches OzBargain plus any enabled gaming sources **in parallel**, normalising each item into a consistent deal shape. Gaming items carry a `type` field (`Freebie`, `Bundle`, or `Deal`) and `votes: 0`
4. `filter.js` applies the category whitelist and keyword filter to all sources; the minimum vote threshold is only applied to OzBargain deals
5. `store.js` loads the persisted set of seen deal IDs and filters out already-seen deals
6. `notifier.js` sends a notification for each new deal — Discord embeds use per-source branding and a layout adapted to the available fields; all other URLs use the Apprise CLI
7. Updated seen IDs are written back to disk and `/tmp/health` is touched
8. When settings are saved via the web UI, `settings.js` validates and writes `settings.json`, the config is rebuilt, and the poll interval restarts with the new settings — no container restart needed

---

## Project Structure

```
dealmaster/
├── index.js              # Entry point — load settings, start web UI + monitor
├── src/
│   ├── config.js         # Config loading — settings.json → env var → default
│   ├── settings.js       # Load/save settings.json with validation
│   ├── web.js            # HTTP settings UI (port 8080) and /api/settings routes
│   ├── fetcher.js        # OzBargain RSS fetch and normalisation
│   ├── filter.js         # Category, keyword, and vote filtering
│   ├── monitor.js        # Poll loop, startup heartbeat, health file
│   ├── notifier.js       # Apprise CLI + Discord embed notification sender
│   └── store.js          # Seen-deal ID persistence (JSON on disk)
├── Dockerfile            # node:22-alpine image with Python3 + apprise
├── docker-compose.yml    # Compose definition with healthcheck and web port
└── .env.example          # Environment variable template
```

---

## Requirements

- **Runtime:** Docker or Podman with Compose support (`docker compose` / `podman-compose`)
- **Notifications:** An Apprise-compatible notification service (Discord, Slack, Telegram, email, etc.)
- **Network:** Outbound HTTPS to `www.ozbargain.com.au` and your notification service endpoint(s). When gaming sources are enabled, also requires outbound HTTPS to `game-deals.app`, `gamerpower.com`, and/or `epicbundle.com`

No accounts, API keys, or external services beyond the above are required.
