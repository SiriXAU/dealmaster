# dealmaster

Monitors [OzBargain](https://www.ozbargain.com.au/deals) and [r/AussieFrugal](https://www.reddit.com/r/AussieFrugal/) for new deals and sends rich notifications to a Discord channel via webhook. Runs as a self-contained Docker container configured entirely via environment variables.

## Quick Start

```bash
docker run -d \
  --name dealmaster \
  -e DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN" \
  -v dealmaster-data:/data \
  dealmaster
```

## With Docker Compose

```bash
# Create a .env file (never commit this)
echo 'DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN' > .env
echo 'CATEGORIES=Computing,Gaming' >> .env

docker compose up -d
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_WEBHOOK_URL` | **Yes** | — | Your Discord webhook URL |
| `CATEGORIES` | No | _(all)_ | Comma-separated category filter, e.g. `"Computing,Gaming"` |
| `POLL_INTERVAL_SECONDS` | No | `120` | How often to check for new deals (minimum 30) |
| `MIN_VOTES` | No | `0` | Only notify on OzBargain deals with at least this many votes¹ |
| `MAX_SEEN_DEALS` | No | `500` | Max deal IDs to remember (prevents unbounded storage) |
| `DISCORD_USERNAME` | No | `OzBargain Deals` | Bot display name in Discord |
| `DATA_DIR` | No | `/data` | Path for persistence file inside the container |
| `REDDIT_ENABLED` | No | `true` | Set to `false` to disable r/AussieFrugal monitoring |

¹ Reddit does not expose vote counts in its RSS feed, so Reddit posts always have `votes: 0`. Setting `MIN_VOTES` above `0` will suppress all Reddit notifications.

## Sources

| Source | Feed | Branding |
|---|---|---|
| [OzBargain](https://www.ozbargain.com.au/deals) | RSS 2.0 | Orange embed, vote count shown |
| [r/AussieFrugal](https://www.reddit.com/r/AussieFrugal/) | Reddit RSS (Atom) | Reddit orange embed, post flair as category |

Both sources are fetched in parallel on every poll. Each source uses its own Discord embed branding. Disable either source via `REDDIT_ENABLED=false` (OzBargain is always on).

## Category Filtering

Category matching is **case-insensitive and substring-based** and applies to both OzBargain categories and Reddit post flair.

| Config value | Matches (OzBargain) | Matches (Reddit flair) |
|---|---|---|
| `Computing` | Computing, Consumer Electronics & Computers | Computing, Tech |
| `Gaming` | Gaming, PC Gaming | Gaming |
| `Food` | Food & Drink, Groceries | Food |
| `Travel` | Travel, Accommodation & Travel | Travel |
| `Home` | Home & Garden, Home Appliances | Home |

Leave `CATEGORIES` empty (or unset) to receive notifications for **all** categories from all sources.

## Building Locally

```bash
git clone https://github.com/SiriXAU/dealmaster
cd dealmaster
docker build -t dealmaster .

docker run -d \
  -e DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." \
  -e CATEGORIES="Computing,Gaming" \
  -e MIN_VOTES=5 \
  -v dealmaster-data:/data \
  dealmaster
```

## Persistence

Seen deal IDs from all sources are stored in `/data/seen-deals.json` inside the container. Mount a volume to persist them across restarts — otherwise the bot will re-notify on all current deals after every restart.

**On first start**, the bot silently seeds all current feed items as "seen" so you won't get spammed. Only deals that appear *after* startup will trigger notifications.

## How it Works

1. Polls OzBargain (`https://www.ozbargain.com.au/deals/feed`) and r/AussieFrugal (`https://www.reddit.com/r/AussieFrugal/new.rss`) in parallel every `POLL_INTERVAL_SECONDS`
2. Filters deals by configured categories and minimum votes
3. Compares against previously seen deal IDs (shared across all sources)
4. Sends a rich Discord embed for each new deal, with source-specific branding
5. Saves updated seen IDs to disk
