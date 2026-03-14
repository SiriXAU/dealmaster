# Dealmaster

Monitors [OzBargain](https://www.ozbargain.com.au/deals) for new deals and posts rich Discord notifications via webhook. Runs as a self-contained container configured entirely via environment variables.

## Quick Start

```bash
# 1. Copy and fill in your webhook URL
cp .env.example .env

# 2. Start
podman-compose up -d        # or: docker compose up -d

# 3. Check the logs
podman logs dealmaster_dealmaster_1
```

On first start, Dealmaster posts the most recent OzBargain deal to your channel so you know it's live, then begins watching for new ones.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_WEBHOOK_URL` | **Yes** | — | Your Discord webhook URL |
| `CATEGORIES` | No | _(all)_ | Comma-separated filter, e.g. `"Computing,Gaming"` |
| `POLL_INTERVAL_SECONDS` | No | `120` | Seconds between feed checks (minimum 30) |
| `MIN_VOTES` | No | `0` | Minimum OzBargain votes required to notify |
| `MAX_SEEN_DEALS` | No | `500` | Maximum deal IDs to retain in the seen-deals store |
| `DISCORD_USERNAME` | No | `Dealmaster` | Display name shown in Discord |
| `DATA_DIR` | No | `/data` | Persistence directory inside the container |

### Category Filtering

Set `CATEGORIES` to a comma-separated list of terms. Matching is **case-insensitive and substring-based**, so `Computing` matches "Computing", "Consumer Electronics & Computers", and so on. Leave it empty (the default) to receive all categories.

## Persistence

Seen deal IDs are stored in `$DATA_DIR/seen-deals.json`. The named volume in `docker-compose.yml` persists this file across restarts, preventing duplicate notifications.

## Health Check

The container includes a Docker/Podman health check. After startup and after every poll cycle, Dealmaster writes a timestamp to `/tmp/health`. The check passes as long as that file has been updated within the last 10 minutes.

```bash
# Check health status
podman inspect --format='{{.State.Health.Status}}' dealmaster_dealmaster_1
```

## How It Works

1. Polls the [OzBargain RSS feed](https://www.ozbargain.com.au/deals/feed) every `POLL_INTERVAL_SECONDS`
2. Filters deals by configured categories and minimum votes
3. Compares against previously seen deal IDs stored on disk
4. Posts a rich Discord embed for each new deal
5. Saves updated seen IDs to disk

## Building Locally

```bash
git clone https://github.com/SiriXAU/dealmaster
cd dealmaster
podman-compose up -d --build
```
