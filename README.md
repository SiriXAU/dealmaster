# Dealmaster

> **Personal project notice:** Dealmaster was vibe-coded for personal use. It scratches a specific itch — getting OzBargain deal notifications directly in a Discord channel without relying on third-party bots or services. It works well for that purpose and is shared here in case it's useful to others, but comes with no guarantees, SLAs, or formal support. Use at your own risk and feel free to fork and adapt it.

Dealmaster monitors [OzBargain](https://www.ozbargain.com.au/deals) for new deals and posts rich Discord embed notifications via webhook. It runs as a self-contained container configured entirely via environment variables, with no database or external dependencies beyond the OzBargain RSS feed.

---

## Features

- Polls the OzBargain RSS feed on a configurable interval
- Posts rich Discord embeds with title, description, category, vote count, author, thumbnail, and timestamp
- Category and minimum-vote filtering to reduce noise
- Startup heartbeat — posts the most recent deal on launch so you know the bot is live
- Persistent seen-deal tracking to prevent duplicate notifications across restarts
- Graceful shutdown on `SIGTERM`/`SIGINT` (plays well with `podman-compose down`)
- Container health check via a polled timestamp file

---

## Quick Start

### Using the pre-built image (recommended)

```bash
# 1. Create your environment file
cp .env.example .env
# Edit .env and set DISCORD_WEBHOOK_URL

# 2. Create a docker-compose.yml that references the published image
# (see "Using the Published Image" section below)

# 3. Start
podman-compose up -d        # or: docker compose up -d

# 4. Confirm it's running
podman logs dealmaster_dealmaster_1
```

### Building from source

```bash
git clone https://github.com/SiriXAU/dealmaster
cd dealmaster
cp .env.example .env
# Edit .env and set DISCORD_WEBHOOK_URL

podman-compose up -d --build
```

On first start, Dealmaster posts the most recent OzBargain deal to your Discord channel so you know it's live, then begins watching for new ones.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_WEBHOOK_URL` | **Yes** | — | Full Discord webhook URL |
| `CATEGORIES` | No | _(all)_ | Comma-separated category filter (see below) |
| `POLL_INTERVAL_SECONDS` | No | `120` | Seconds between feed checks — minimum `30` |
| `MIN_VOTES` | No | `0` | Minimum OzBargain vote count required to notify |
| `MAX_SEEN_DEALS` | No | `500` | Maximum deal IDs to retain in the persistence store |
| `DISCORD_USERNAME` | No | `Dealmaster` | Display name shown in Discord for the webhook bot |
| `DATA_DIR` | No | `/data` | Path for the persistence file inside the container |

### Getting a Discord webhook URL

1. Open your Discord server → **Server Settings** → **Integrations** → **Webhooks**
2. Click **New Webhook**, choose a channel, and copy the URL
3. Paste it as `DISCORD_WEBHOOK_URL` in your `.env` file

> **Security note:** Treat your webhook URL as a secret. Anyone with it can post to your channel. Keep it out of version control — `.env` is in `.gitignore` for this reason.

---

## Category Filtering

Set `CATEGORIES` to a comma-separated list of terms to only receive deals in matching categories. Matching is **case-insensitive and substring-based**, so a single term can match several OzBargain category names.

| `CATEGORIES` value | Example categories matched |
|---|---|
| `Computing` | Computing, Consumer Electronics & Computers |
| `Gaming` | Gaming, PC Gaming |
| `Food` | Food & Drink, Groceries & Liquor |
| `Travel` | Travel, Accommodation & Travel |
| `Home` | Home & Garden, Home Appliances |
| `Electrical` | Electrical & Electronics |

Leave `CATEGORIES` empty (the default) to receive all categories.

**Example `.env` for computing and gaming deals only:**
```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
CATEGORIES=Computing,Gaming
MIN_VOTES=5
```

---

## Startup Behaviour

On every start Dealmaster:

1. Fetches the current OzBargain feed
2. Posts the single most recent (filtered) deal to Discord as a liveness signal
3. Marks all current feed items as seen
4. Enters the regular poll loop

This means you always get at least one message in Discord on startup confirming the bot is running, and the first real poll will only notify on deals that appear *after* that point.

---

## Persistence

Seen deal IDs are stored in `$DATA_DIR/seen-deals.json` (default: `/data/seen-deals.json`). The named volume in `docker-compose.yml` persists this file across container restarts, preventing duplicate notifications.

The store is capped at `MAX_SEEN_DEALS` entries (default: `500`). When the cap is reached, the oldest entries are trimmed. With a 2-minute poll interval and typical OzBargain posting volume this is more than enough to prevent duplicates indefinitely.

**Resetting state** (to replay all current deals):
```bash
podman-compose down
podman volume rm dealmaster_dealmaster-data
podman-compose up -d
```

---

## Health Check

After startup and after every poll cycle, Dealmaster writes a timestamp to `/tmp/health` inside the container. The health check defined in `docker-compose.yml` verifies that file has been updated within the last 10 minutes. If the poll loop stalls or crashes, the container will be marked unhealthy.

```bash
# Check current health status
podman inspect --format='{{.State.Health.Status}}' dealmaster_dealmaster_1
```

Possible statuses: `starting` (within the 30s start period), `healthy`, `unhealthy`.

---

## Publishing the Image

### Manual publish to GitHub Container Registry

```bash
# Authenticate (once)
podman login ghcr.io -u YOUR_GITHUB_USERNAME

# Build in Docker format (required for HEALTHCHECK support if baking it into the image)
podman build --format docker -t ghcr.io/siriaxu/dealmaster:latest .

# Tag a versioned release
podman tag ghcr.io/siriaxu/dealmaster:latest ghcr.io/siriaxu/dealmaster:1.0.0

# Push
podman push ghcr.io/siriaxu/dealmaster:latest
podman push ghcr.io/siriaxu/dealmaster:1.0.0
```

Make the package public in **GitHub → Packages → dealmaster → Package settings → Change visibility**.

### Automated publish via GitHub Actions

A workflow is included at `.github/workflows/publish.yml` that automatically builds and pushes to GHCR on every push to `main`. No secrets configuration is needed — it uses the built-in `GITHUB_TOKEN`.

### Using the published image

Replace the `build: .` directive in `docker-compose.yml` with an `image:` reference:

```yaml
services:
  dealmaster:
    image: ghcr.io/siriaxu/dealmaster:latest
    restart: unless-stopped
    environment:
      - DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
      - CATEGORIES=${CATEGORIES:-}
      - POLL_INTERVAL_SECONDS=${POLL_INTERVAL_SECONDS:-120}
      - MIN_VOTES=${MIN_VOTES:-0}
      - MAX_SEEN_DEALS=${MAX_SEEN_DEALS:-500}
      - DISCORD_USERNAME=${DISCORD_USERNAME:-Dealmaster}
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

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                     index.js                        │
│  Loads config → registers shutdown handlers         │
│  → calls startMonitor()                             │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                   monitor.js                        │
│  startMonitor()  — startup heartbeat deal + seed    │
│  runOnce()       — fetch → filter → diff → notify  │
│                    → persist → touch /tmp/health    │
└──────┬────────────────────────────────┬─────────────┘
       │                                │
┌──────▼───────┐               ┌────────▼──────────────┐
│  fetcher.js  │               │     notifier.js        │
│  OzBargain   │               │  buildEmbed()          │
│  RSS → deals │               │  sendDealNotification()│
└──────────────┘               └────────────────────────┘
       │
┌──────▼───────┐
│  filter.js   │
│  category +  │
│  vote filter │
└──────────────┘
       │
┌──────▼───────┐
│   store.js   │
│  seen-deals  │
│  .json R/W   │
└──────────────┘
```

1. `index.js` loads and validates configuration from environment variables, registers `SIGTERM`/`SIGINT` handlers, and calls `startMonitor()`
2. On startup, `monitor.js` fetches the current feed, posts the most recent deal to Discord, marks everything as seen, then enters the poll loop
3. On each poll, `fetcher.js` fetches and parses the OzBargain RSS feed, normalising each item into a consistent deal shape
4. `filter.js` applies the category whitelist and minimum vote threshold
5. `store.js` loads the persisted set of seen deal IDs and filters out already-seen deals
6. `notifier.js` builds a Discord embed and POSTs it to the webhook URL for each new deal
7. Updated seen IDs are written back to disk and `/tmp/health` is touched

---

## Project Structure

```
dealmaster/
├── index.js              # Entry point — config, shutdown handlers, start
├── src/
│   ├── config.js         # Environment variable loading and validation
│   ├── fetcher.js        # OzBargain RSS fetch and normalisation
│   ├── filter.js         # Category and vote filtering
│   ├── monitor.js        # Poll loop, startup heartbeat, health file
│   ├── notifier.js       # Discord embed construction and webhook POST
│   └── store.js          # Seen-deal ID persistence (JSON on disk)
├── Dockerfile            # node:22-alpine image
├── docker-compose.yml    # Compose definition with healthcheck
├── .env.example          # Environment variable template
└── .github/
    └── workflows/
        └── publish.yml   # Automated GHCR publish on push to main
```

---

## Requirements

- **Runtime:** Docker or Podman with Compose support (`docker compose` / `podman-compose`)
- **Discord:** A server where you have permission to create webhooks
- **Network:** Outbound HTTPS to `www.ozbargain.com.au` and `discord.com`

No accounts, API keys, or external services beyond the above are required.
