# Dealmaster

> **Personal project notice:** Dealmaster was vibe-coded for personal use. It scratches a specific itch — getting OzBargain deal notifications directly in a notification service without relying on third-party bots or services. It works well for that purpose and is shared here in case it's useful to others, but comes with no guarantees, SLAs, or formal support. Use at your own risk and feel free to fork and adapt it.

Dealmaster monitors [OzBargain](https://www.ozbargain.com.au/deals) for new deals and sends notifications via [Apprise](https://github.com/caronc/apprise), supporting 100+ services (Discord, Slack, Telegram, email, and more). It runs as a self-contained container configured entirely via environment variables, with no database or external dependencies beyond the OzBargain RSS feed.

---

## Features

- Polls the OzBargain RSS feed on a configurable interval
- Sends notifications via Apprise to any supported service (Discord, Slack, Telegram, email, and more)
- Discord URLs receive **rich embeds** — coloured card with price, store, delivery method, category, votes, author, expiry, thumbnail, and timestamp
- Category and minimum-vote filtering to reduce noise
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
    environment:
      - APPRISE_URLS=${APPRISE_URLS}
      - CATEGORIES=${CATEGORIES:-}
      - POLL_INTERVAL_SECONDS=${POLL_INTERVAL_SECONDS:-120}
      - MIN_VOTES=${MIN_VOTES:-0}
      - MAX_SEEN_DEALS=${MAX_SEEN_DEALS:-500}
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

On first start, Dealmaster sends a notification for the most recent OzBargain deal so you know it's live, then begins watching for new ones.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `APPRISE_URLS` | **Yes** | — | Comma-separated list of Apprise notification URLs |
| `CATEGORIES` | No | _(all)_ | Comma-separated category filter (see below) |
| `POLL_INTERVAL_SECONDS` | No | `120` | Seconds between feed checks — minimum `30` |
| `MIN_VOTES` | No | `0` | Minimum OzBargain vote count required to notify |
| `MAX_SEEN_DEALS` | No | `500` | Maximum deal IDs to retain in the persistence store |
| `DATA_DIR` | No | `/data` | Path for the persistence file inside the container |

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
APPRISE_URLS=discord://YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
CATEGORIES=Computing,Gaming
MIN_VOTES=5
```

---

## Startup Behaviour

On every start Dealmaster:

1. Fetches the current OzBargain feed
2. Sends a notification for the single most recent (filtered) deal as a liveness signal
3. Marks all current feed items as seen
4. Enters the regular poll loop

This means you always receive a startup notification confirming the tool is running, and the first real poll will only notify on deals that appear *after* that point.

---

## Persistence

Seen deal IDs are stored in `$DATA_DIR/seen-deals.json` (default: `/data/seen-deals.json`). The named volume in `docker-compose.yml` persists this file across container restarts, preventing duplicate notifications.

The store is capped at `MAX_SEEN_DEALS` entries (default: `500`). When the cap is reached, the oldest entries are trimmed. With a 2-minute poll interval and typical OzBargain posting volume this is more than enough to prevent duplicates indefinitely.

**Resetting state** (to re-notify on all current deals):
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
│  OzBargain   │               │  Apprise CLI           │
│  RSS → deals │               │  notification sender   │
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
2. On startup, `monitor.js` fetches the current feed, sends a startup notification, marks everything as seen, then enters the poll loop
3. On each poll, `fetcher.js` fetches and parses the OzBargain RSS feed, normalising each item into a consistent deal shape
4. `filter.js` applies the category whitelist and minimum vote threshold
5. `store.js` loads the persisted set of seen deal IDs and filters out already-seen deals
6. `notifier.js` calls the Apprise CLI to send a notification to all configured URLs for each new deal
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
│   ├── notifier.js       # Apprise CLI notification sender
│   └── store.js          # Seen-deal ID persistence (JSON on disk)
├── Dockerfile            # node:22-alpine image with Python3 + apprise
├── docker-compose.yml    # Compose definition with healthcheck
└── .env.example          # Environment variable template
```

---

## Requirements

- **Runtime:** Docker or Podman with Compose support (`docker compose` / `podman-compose`)
- **Notifications:** An Apprise-compatible notification service (Discord, Slack, Telegram, email, etc.)
- **Network:** Outbound HTTPS to `www.ozbargain.com.au` and your notification service endpoint(s)

No accounts, API keys, or external services beyond the above are required.
