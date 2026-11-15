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
- **Filter profiles** — multiple named profiles, each with its own Apprise URLs, categories, keywords, minimum votes, and schedule. Route gaming deals to one Discord channel and grocery deals to another with no overlap. Legacy single-filter setups auto-migrate to a `default` profile on first load
- **Quiet hours / digest mode** — per-profile schedule with timezone, quiet windows that hold deals until the window ends, and a configurable daily digest time. Held deals are persisted to disk and survive restarts
- **Cross-source deduplication** — the same deal posted to OzBargain and GamerPower in the same 24h window only notifies once, via a normalised title + price fuzzy hash. Duplicates are removed after each profile's filters run, so a copy a profile rejects never hides one it accepts
- Sends notifications via Apprise to any supported service (Discord, Slack, Telegram, email, and more)
- Discord URLs receive **rich embeds** — coloured card with source-specific branding, price, store, category, and relevant metadata. Digest deliveries fold up to 10 queued deals into a single embed
- **Web settings UI** — change any setting live at `http://localhost:8080`, dark mode and mobile-friendly. Profile pill picker, per-profile schedule editor with quiet-hours rows, and profile-match chips on the Recent Deals tab
- **Input validation** — settings POST endpoint validates all fields and returns structured error responses
- Category, keyword, and minimum-vote filtering to reduce noise (gaming sources bypass the vote threshold)
- **Content-based deduplication** — prevents re-notification when a deal is reposted with a different ID (hashes title + link + price)
- Startup heartbeat — sends a notification for the most recent not-yet-seen matching deal on launch so you know it's live (disable with `STARTUP_NOTIFICATION=false`)
- Persistent seen-deal tracking and content hash store to prevent duplicate notifications across restarts
- **Notification history** — last 50 notified deals stored and viewable via `GET /api/history`
- **Recent Deals tab** — web UI tab showing all deals (notified, queued for digest, and filtered) from the last 24 hours with profile-match chips and filter reasons
- **Health endpoint** — `GET /health` returns JSON health status (200/503) based on poll cycle freshness
- Retry logic with exponential backoff on feed fetch failures (5xx, 429, timeouts, network errors); all outbound requests have timeouts
- Failed realtime notifications are retried on the next polls (up to 3 attempts) instead of being dropped — only to the destinations that failed, so the ones that succeeded don't get duplicates
- **Optional password protection** for the web UI (`WEB_PASSWORD`), CSRF protection on the settings API, and notification URLs are never returned in full by the API
- Discord webhook rate limiting with `Retry-After` header handling
- **Structured logging** — timestamped, levelled log output; configurable via `LOG_LEVEL` env var
- Graceful shutdown on `SIGTERM`/`SIGINT` (plays well with `podman-compose down`) — pending digests are persisted before exit
- **Atomic data files** — everything in the data volume is written via temp file + rename, so a crash can't leave a corrupt file behind
- **Runs as a non-root user** inside the container
- **Test suite** — unit tests across filter, fetcher, config, notifier, store, scheduler, digest queue, settings, monitor, and web modules; `npm test` (runs in CI on every push and pull request)

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
      # Optional — protect the web UI with a password (recommended on a server)
      - WEB_PASSWORD=${WEB_PASSWORD:-}
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

On first start, Dealmaster sends a notification for the most recent deal matching your filters so you know it's live, then begins watching for new ones. Open **http://localhost:8080** to configure settings via the web interface.

> **Upgrading from v1.0.3 or earlier:** the container now runs as the unprivileged `node` user. On start-up it takes ownership of the files already in your data volume automatically, so no manual steps are needed.

---

## Web Settings Interface

Dealmaster includes a built-in settings UI served on port 8080 inside the container. Open it in any browser — it works on desktop and mobile, and supports dark mode automatically.

A static mock-up of the settings page is in [`preview.html`](preview.html) — open it in a browser to see the layout without running the app.

### What you can configure

The settings page is split into a **profile picker** at the top, a **per-profile detail card**, and a **global section** at the bottom.

**Per-profile settings** (each profile has its own copies):

| Setting | Description |
|---|---|
| **Profile name** | Human-readable label (the slug `id` is auto-derived and shown beneath) |
| **Notification URLs** | Apprise URLs that receive deals matching this profile, one per line. Saved URLs are shown masked (`discord://••••abcd`); leave a masked line as-is to keep it, or replace it in full to change it |
| **Categories** | Category chips or comma-separated custom terms |
| **Keyword Filter** | Only notify for deals whose title, description, or store matches a keyword |
| **Minimum Votes** | OzBargain vote threshold (gaming sources always pass) |
| **Schedule** | `Realtime` (fire immediately) / `Digest` (batch at digest time) / `Quiet` (hold deals during quiet hours), plus timezone, daily digest time, and zero or more quiet-hour windows |

**Global settings** (apply across all profiles):

| Setting | Description |
|---|---|
| **Poll Interval** | How often to check all enabled feeds for new deals (minimum 30s) |
| **Max Seen Deals** | Memory cap for the deduplication store |
| **Gaming Sources** | Toggle GamerPower (Giveaways / Games / Loot) and EpicBundle on/off independently |

Changes take effect **immediately** — the poll loop restarts with the new settings without restarting the container.

### Filter profiles

Profiles let you fan deals out to different audiences with different rules. Use cases:

- **Gaming Discord** for free games & loot, **Pushover** for high-vote tech deals
- **Quiet personal channel** with `MIN_VOTES=25` and a 22:00–07:00 quiet window, plus a separate **work channel** with grocery/food keywords only
- **Daily digest** to email at 08:00 with the day's wins, instead of pings throughout the day

Each profile is evaluated independently against every fetched deal — a single deal can match multiple profiles, in which case it goes to all of them. Profiles that don't match a deal don't see it. The Recent Deals tab shows a chip for each profile that matched.

The **schedule** card supports three modes:

| Mode | Behaviour |
|---|---|
| **Realtime** | Deals fire immediately when matched (default) |
| **Digest** | Deals queue silently and fire as one consolidated message at the daily `Digest at` time |
| **Quiet** | Deals fire immediately outside the profile's quiet-hour windows; inside a window they queue and go out as one digest when it ends. With no quiet windows configured, this behaves like Realtime |

Quiet windows apply in every mode:

- A **Realtime** (or **Quiet**) profile with a `22:00–07:00` window queues overnight deals and sends them as one digest at 07:00.
- A **Digest** profile keeps its daily digest time. If that time falls inside a quiet window (e.g. digest at 06:00, quiet 22:00–07:00), the digest is held and sent when the window ends (07:00) — this also works if the container restarts in between.

### Recent Deals tab

The **Recent Deals** tab shows all deals fetched in the last 24 hours, including those that were filtered out. Each deal card displays:

- **Title** (linked to the deal page)
- **Source** with colour-coded dot (orange for OzBargain, red for GamerPower, purple for EpicBundle)
- **Price, store, votes, and category**
- **Profile chips** — orange chips listing every profile that matched this deal (e.g. `[default] [gaming]`)
- **Filter status** — green "Notified" badge, amber "Queued for digest" badge, or grey "Skipped" badge with the reason (e.g. "below min votes: 3 < 5", "category mismatch", "already seen", "cross-source duplicate")
- **Relative timestamp** (e.g. "12 min ago", "2 hours ago")

This is useful for seeing which profiles caught which deals and tuning your filters without checking multiple notification channels.

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

Set `WEB_PASSWORD` to require HTTP basic auth for the web UI and API (any username is accepted; `/health` stays open for container health checks). Without it, anyone who can reach the port can change your settings.

Other protections are always on:

- `POST /api/settings` only accepts `Content-Type: application/json` and rejects requests whose `Origin` doesn't match the host, so other websites you visit can't change your settings. If you serve the UI through a reverse proxy that rewrites the `Host` header, list the public origin(s) in `WEB_TRUSTED_ORIGINS` (e.g. `https://deals.example.com`).
- Notification URLs contain webhook tokens, so `GET /api/settings` returns them masked (`discord://••••abcd`). Saving a masked URL unchanged keeps the stored one; to change a URL, replace it in full.

For a server deployment you can also put Dealmaster behind a reverse proxy (nginx, Caddy, Traefik), or remove the `ports` binding from `docker-compose.yml` and access the UI via an SSH tunnel:

```bash
ssh -L 8080:localhost:8080 your-server
# then open http://localhost:8080
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | HTML settings UI |
| `GET` | `/api/settings` | Current configuration as JSON (notification URLs masked) |
| `POST` | `/api/settings` | Save new configuration — requires `Content-Type: application/json` and a same-origin request (validated, returns `{error, field}` on failure) |
| `GET` | `/api/history` | Last 50 notified deals as JSON array |
| `GET` | `/api/deals` | All deals from the last 24 hours with filter/notify status |
| `GET` | `/api/deals/count` | `{"count":…,"notified":…}` for the last 24 hours |
| `GET` | `/health` | Health status — `{"healthy":true,"lastPollMsAgo":…}` (200/503) |

When `WEB_PASSWORD` is set, every endpoint except `/health` requires HTTP basic auth.

---

## Environment Variables

These seed the auto-created `default` filter profile on first run, before any `settings.json` exists. Once the web UI has been used to save settings (or `settings.json` has been written by any means), env vars for the per-profile fields are ignored — the file wins. Global env vars (`POLL_INTERVAL_SECONDS`, `MAX_SEEN_DEALS`, `LOG_LEVEL`, `DATA_DIR`, `WEB_PORT`, gaming source toggles) still take effect on every start when not present in `settings.json`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `APPRISE_URLS` | **Yes** (first run) | — | Comma-separated list of Apprise notification URLs |
| `CATEGORIES` | No | _(all)_ | Comma-separated category filter (see below) |
| `KEYWORDS` | No | _(all)_ | Comma-separated keyword filter — matches title, description, and store name |
| `POLL_INTERVAL_SECONDS` | No | `120` | Seconds between feed checks — minimum `30` |
| `MIN_VOTES` | No | `0` | Minimum OzBargain vote count required to notify (does not affect gaming sources) |
| `MAX_SEEN_DEALS` | No | `500` | Maximum deal IDs to retain in the persistence store (whole number ≥ 1) |
| `LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, or `error` |
| `GAMERPOWER_ENABLED` | No | `false` | Set to `true` to enable the GamerPower all-giveaways feed |
| `GAMERPOWER_GAMES_ENABLED` | No | `false` | Set to `true` to enable the GamerPower full-games-only feed |
| `GAMERPOWER_LOOT_ENABLED` | No | `false` | Set to `true` to enable the GamerPower loot/DLC-only feed |
| `EPICBUNDLE_ENABLED` | No | `false` | Set to `true` to enable the EpicBundle feed |
| `DATA_DIR` | No | `/data` | Path for persistence files inside the container — not configurable via web UI |
| `WEB_PORT` | No | `8080` | Host port mapped to the web settings UI (container always listens on 8080 internally) |
| `WEB_PASSWORD` | No | _(none)_ | Require HTTP basic auth with this password for the web UI and API |
| `WEB_TRUSTED_ORIGINS` | No | _(none)_ | Comma-separated extra origins allowed to POST settings (for reverse proxies that rewrite `Host`) |
| `STARTUP_NOTIFICATION` | No | `true` | Set to `false` to skip the startup liveness notification |
| `HEALTH_FILE` | No | `/tmp/health` | File rewritten after every successful poll, for file-based container health checks |

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

> **Discord tip:** The webhook URL `https://discord.com/api/webhooks/1234/abcd` maps to `discord://1234/abcd`. Discord URLs receive **rich embeds** (coloured card with inline fields and thumbnail) sent directly via the webhook API — identical in appearance to the native Discord bot format. Discord notifications include per-webhook rate limiting (1s minimum interval) and automatic 429 retry handling. All other Apprise URLs receive a plain-text notification via the Apprise CLI — one `apprise` call per URL, so each destination succeeds or fails on its own.

See the [Apprise wiki](https://github.com/caronc/apprise/wiki) for all supported services and URL formats.

**Multiple services example:**
```
APPRISE_URLS=discord://id/token,slack://TokenA/TokenB/TokenC/Channel
```

If a notification fails, Dealmaster retries it on the next poll(s), up to 3 attempts in total — and only to the destinations that failed, so the ones that already got it don't receive a duplicate. Pending retries are kept in memory, so a restart drops them.

> **Security note:** Treat your notification URLs as secrets — they grant posting access to your channels. Keep them out of version control — `.env` is in `.gitignore` for this reason. URLs can't start with `-` (they'd be read as an Apprise option), and the web API never returns them in full.

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
- **Overlapping feeds** — GamerPower · Giveaways already includes everything in Games and Loot. Enabling them together is safe: a giveaway returned by more than one feed is only sent once.

### Startup behaviour with gaming sources

On startup, Dealmaster fetches all enabled sources in parallel and seeds their current items as seen — the same way it handles OzBargain. At most one startup notification is sent (see [Startup Behaviour](#startup-behaviour)) to avoid flooding your channel.

The same seeding happens when a source returns deals for the first time later on — for example if it was unreachable at startup, or you enable it in the web UI — so its existing giveaways are never sent as a burst.

---

## Startup Behaviour

On every start Dealmaster:

1. Loads configuration from `settings.json` (if it exists) or environment variables
2. Starts the web settings UI
3. Fetches the current feed from OzBargain and any enabled gaming sources (in parallel)
4. Sends a notification for the most recent deal that matches the **first** profile and hasn't been seen before, as a liveness signal. It's skipped if there's no such deal — which is usual on a restart, since the feed was already seen — or if `STARTUP_NOTIFICATION=false`
5. Marks all current feed items and their content hashes as seen
6. Enters the regular poll loop

The first real poll will only notify on deals that appear *after* that point. If a source can't be reached at startup, it is seeded silently on its first successful poll rather than sending its whole feed.

---

## Persistence

Five files are stored in `$DATA_DIR` (default `/data`), persisted via the named Docker volume:

| File | Purpose |
|---|---|
| `settings.json` | Profiles, schedules, and global settings saved via the web UI — takes precedence over env vars on startup |
| `seen-deals.json` | IDs, content hashes, and fuzzy hashes of every deal already fetched (notified or not) — prevents duplicates across restarts |
| `history.json` | Last 50 notified deals with titles, links, sources, and timestamps |
| `deal-log.json` | All deals from the last 24 hours — notified, queued, and filtered — for the Recent Deals web UI tab |
| `pending-digest.json` | Per-profile queue of deals waiting for the next digest delivery — sent at `digestAt` or when a quiet window ends, and saved to disk on graceful shutdown so nothing is lost across restarts |

All files are written atomically (temp file + rename), so a crash or full disk mid-write leaves the previous version intact.

The seen-deal store is capped at `MAX_SEEN_DEALS` entries (default: `500`). When the cap is reached, the entries seen least recently are trimmed first — deals still in a feed keep being refreshed, so they aren't evicted. With a 2-minute poll interval and typical OzBargain posting volume this is more than enough to prevent duplicates indefinitely. If you enable all gaming sources, consider raising it (e.g. `1000`), since GamerPower alone can list 100+ live giveaways.

Three layers of deduplication run on every poll cycle, both against earlier polls and within the current one:

1. **Exact ID** — the feed's GUID/link
2. **Content hash** — SHA-256 of `title + link + price`, catches the same deal reposted with a fresh GUID within a 24h window
3. **Fuzzy hash** — SHA-256 of normalised title (lowercased, punctuation stripped, whitespace collapsed) + price, catches the same deal cross-posted from OzBargain and GamerPower

Within a poll, duplicates are removed per profile *after* that profile's filters run. That way an OzBargain post below a profile's minimum votes can't hide the same giveaway arriving from GamerPower (which ignores the vote threshold).

**Resetting seen deals** (to re-notify on all current deals):
```bash
podman-compose down
podman volume rm <project-directory>_dealmaster-data
podman-compose up -d
```

> The volume name is prefixed with the name of the directory containing your `docker-compose.yml`. For example, if your directory is `~/dealmaster`, the volume will be named `dealmaster_dealmaster-data`.

**File ownership:** the app runs as the `node` user (UID 1000). The container's entrypoint starts as root only long enough to `chown` the data directory, then drops privileges — so existing volumes and bind mounts work without changes. If you run the container with `--user`, make sure that user can write to the data directory.

---

## Health Check

Dealmaster exposes a `GET /health` HTTP endpoint that returns the health status:

```json
{"healthy":true,"lastPollMsAgo":45000,"pollIntervalMs":120000}
```

A poll cycle counts as successful when at least one enabled source returned deals. The service is healthy if the last successful cycle was within 3× the configured poll interval. The status code is `200` when healthy and `503` when stale. This endpoint never requires a password.

The image has a built-in `HEALTHCHECK` that calls this endpoint, and the example `docker-compose.yml` defines the same check. If the poll loop stalls or every source keeps failing, the container will be marked unhealthy.

Dealmaster also rewrites a **health file** (`/tmp/health` by default, override with `HEALTH_FILE`) after every successful poll, containing the poll timestamp. A health check that doesn't use HTTP can test the file's age instead, for example:

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "try{const s=require('fs').statSync('/tmp/health');if(Date.now()-s.mtimeMs>600000)process.exit(1);}catch(e){process.exit(1);}"]
```

The HTTP check is preferred, because it follows your poll interval automatically (stale after 3× the interval) rather than a fixed age.

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
2026-05-03T10:30:00.000Z [WARN] [fetcher] Retry 1/3 for epicbundle in 1000ms (Status code 503)
```

Set `LOG_LEVEL` to control verbosity:

| Level | Shows |
|---|---|
| `debug` | Everything (currently the same as `info`) |
| `info` | Startup banner, poll loop, notifications sent, digest flushes, source seeding, settings saves |
| `warn` | Transient errors, fetch retries, rate limits, digest queue overflow |
| `error` | Failed fetches and notifications, giving up on a retry, unreadable settings |

The default is `info`.

---

## How It Works

```
                      ┌──────────────────────────────┐
                      │           index.js           │
                      │  Load settings → loadConfig  │
                      │  Web UI + startMonitor()     │
                      │  SIGTERM → persist queue     │
                      └──────────┬───────────────────┘
                                 │
                      ┌──────────▼───────────────────┐
                      │          monitor.js          │
                      │  Poll cycle:                 │
                      │   fetch → for each profile:  │
                      │     filterForProfile         │
                      │     dedupe (id + hash + fuz) │
                      │     skip already-seen        │
                      │     mode = realtime|digest|  │
                      │            quiet             │
                      │       realtime → notify      │
                      │       digest/quiet → enqueue │
                      │   retry failed destinations  │
                      │   schedule digest timers     │
                      └─┬───────────┬────────────┬───┘
                        │           │            │
              ┌─────────▼──┐ ┌──────▼────┐ ┌─────▼────────┐
              │  fetcher   │ │ scheduler │ │ digestQueue  │
              │  (sources) │ │ (Intl tz) │ │ pending-     │
              └─────────┬──┘ └───────────┘ │ digest.json  │
                        │                  └──────────────┘
              ┌─────────▼──┐
              │   filter   │
              │  per-profile category +
              │  keyword + vote filter
              └─────────┬──┘
                        │
              ┌─────────▼─────────────┐
              │         store         │
              │  seen-deals.json      │
              │  ids + hash + fuzzy   │
              │  24h cross-source     │
              │  dedup window         │
              └─────────┬─────────────┘
                        │
              ┌─────────▼────────────┐         ┌──────────────┐
              │      notifier        │ ───────▶│  Apprise CLI │
              │  Discord embed (per  │         │   Discord    │
              │  source branding) +  │         │   webhook    │
              │  digest assembly     │         │   directly   │
              │  + rate limit + 429  │         └──────────────┘
              └──────────────────────┘
```

1. `index.js` loads `settings.json` (if present), migrates any legacy single-filter shape into a `default` profile, builds config, starts the web UI, registers shutdown handlers (which persist `pending-digest.json`), and calls `startMonitor()`
2. On startup, `monitor.js` fetches all enabled sources, sends a startup notification for the most recent unseen deal that matches the first profile, seeds all items and content/fuzzy hashes as seen, then starts the poll loop (each poll is scheduled only after the previous one finishes, and polls never overlap with digest sends) and the per-profile digest timers
3. On each poll, `fetcher.js` calls `fetchAllDeals(config)` which fetches OzBargain plus any enabled gaming sources **in parallel**, normalising each item into a consistent deal shape. Failed fetches (5xx, 429, timeouts, network errors) are retried with exponential backoff (up to 3 retries). GamerPower is fetched via their JSON API; EpicBundle uses RSS. A source returning deals for the first time is seeded silently instead of notifying
4. For **each profile**, `filter.js` runs `filterForProfile(deals, profile)` against the profile's own category whitelist, keyword list, and minimum-vote threshold (the threshold only applies to OzBargain deals). The profile's matches are then de-duplicated among themselves (same id, same content, or the same deal on two sources)
5. Matches that were already seen are skipped, using the three layers stored by `store.js`: exact GUID/link, content hash (`title+link+price`), and fuzzy hash (normalised title + price). The fuzzy layer collapses cross-source duplicates within the 24h window
6. `scheduler.js` decides each profile's effective mode for *now*: realtime, digest, or quiet (quiet wins inside any quiet-hour window). Realtime matches go straight to `notifier.js`; digest/quiet matches go into `digestQueue.js`
7. `notifier.js` sends notifications — Discord embeds use per-source branding with rate limiting (1s minimum interval, automatic 429 retry); all other URLs use the Apprise CLI, one call per URL. Each destination reports its own result, and failed destinations are retried on the next poll(s), up to 3 attempts. Digest deliveries fold up to 10 deals into a single embed/markdown message
8. Per-profile digest timers re-arm every poll cycle. They fire either at `digestAt` (in the profile's timezone) or when a quiet-hour window ends, draining the queue into one digest per profile. If a digest profile's `digestAt` falls inside its quiet hours, the digest is sent when the quiet window ends
9. Newly seen IDs and hashes are written back to disk, a history entry is appended, the deal log is updated with profile-match and queued/notified status, and the health timestamp (and `/tmp/health` file) is updated. All data files are written atomically (temp file + rename) so a crash can't corrupt them
10. When settings are saved via the web UI, `settings.js` validates and writes `settings.json`, the config is rebuilt, and the poll interval restarts with the new settings — no container restart needed

---

## Project Structure

```
dealmaster/
├── index.js                # Entry point — load settings, start web UI + monitor
├── src/
│   ├── config.js           # Config loading — settings.json → env var → default
│   ├── settings.js         # Profile schema, validation, legacy migration
│   ├── web.js              # HTTP server — /api/*, /health, auth + CSRF checks, URL masking
│   ├── fsUtil.js           # Atomic file writes
│   ├── fetcher.js          # Feed fetching with retry — OzBargain RSS, GamerPower JSON API, EpicBundle RSS
│   ├── filter.js           # Per-profile category, keyword, and vote filtering
│   ├── monitor.js          # Multi-profile poll loop, digest scheduling, health tracking
│   ├── notifier.js         # Discord embed + Apprise CLI sender with rate limiting; digest assembly
│   ├── scheduler.js        # Pure timezone-aware mode/window helpers (Realtime/Digest/Quiet)
│   ├── digestQueue.js      # Per-profile pending-digest queue with cap and disk persistence
│   ├── store.js            # Seen-deal + content-hash + fuzzy-hash persistence (JSON on disk)
│   ├── history.js          # Notification history log (last 50 deals)
│   ├── dealLog.js          # Deal activity log — all deals, filtered + notified + queued (24h window)
│   └── logger.js           # Structured logging with timestamps and levels
├── test/
│   ├── filter.test.js      # Filter + filterForProfile unit tests
│   ├── fetcher.test.js     # Normalization unit tests
│   ├── config.test.js      # Config loading tests
│   ├── notifier.test.js    # Discord URL parsing + embed building tests
│   ├── store.test.js       # Content hash + fuzzy hash + persistence tests
│   ├── scheduler.test.js   # Timezone/quiet-hours/digestAt logic tests
│   ├── digestQueue.test.js # Queue enqueue/drain/cap tests
│   ├── settings.test.js    # Profile schema + legacy migration tests
│   ├── monitor.test.js     # Poll cycle: dedup, retries, seeding, digest queueing
│   └── web.test.js         # Web API: masking, CSRF, auth, validation
├── public/
│   └── index.html          # Web settings UI
├── .github/workflows/
│   ├── test.yml            # Runs npm test on Node 18 + 22 for every push to main and every PR
│   ├── bump-version.yml    # Manual: bump version and open a release PR
│   ├── release.yml         # Tags + GitHub Release when a release PR merges
│   └── publish.yml         # Builds and pushes the container image to GHCR
├── preview.html            # Static mock-up of the settings UI
├── Dockerfile              # node:22-alpine image with Python3 + apprise; runs as the `node` user
├── docker-entrypoint.sh    # Fixes /data ownership, then drops root privileges
├── docker-compose.yml      # Compose definition with HTTP healthcheck and web port
├── .env.example            # Environment variable template
├── .gitignore
└── .dockerignore
```

---

## Development

```bash
# Install dependencies
npm install

# Run the test suite (no network access or apprise install needed)
npm test

# Run the app locally (needs APPRISE_URLS set; DATA_DIR defaults to /data)
DATA_DIR=./data APPRISE_URLS=discord://id/token node index.js

# Run with debug logging
LOG_LEVEL=debug DATA_DIR=./data APPRISE_URLS=discord://id/token node index.js
```

Node.js >= 18 is required. Non-Discord notification URLs also need the [Apprise CLI](https://github.com/caronc/apprise) on your `PATH` (`pip install apprise`); the container image includes it.

---

## Requirements

- **Runtime:** Docker or Podman with Compose support (`docker compose` / `podman-compose`)
- **Notifications:** An Apprise-compatible notification service (Discord, Slack, Telegram, email, etc.)
- **Network:** Outbound HTTPS to `www.ozbargain.com.au` and your notification service endpoint(s). When gaming sources are enabled, also requires outbound HTTPS to `www.gamerpower.com` and/or `epicbundle.com`

No accounts, API keys, or external services beyond the above are required.

---

## Troubleshooting

### 403 / Cloudflare "Verify you are human" from OzBargain

OzBargain uses Cloudflare to protect against bots. If you see `[ERROR] [fetcher] Failed to fetch OzBargain feed: Status code 403`, Cloudflare is blocking the request. Dealmaster uses a browser-like `User-Agent` header (Chrome on Windows) with proper `Accept` and `Accept-Language` headers to avoid being flagged.

If the 403 persists, OzBargain may have deployed a JavaScript challenge (which cannot be solved without a real browser). In that case:

1. Visit `https://www.ozbargain.com.au` in a browser on the same network — this may reduce the challenge frequency
2. Check if the RSS feed is temporarily unavailable by visiting `https://www.ozbargain.com.au/deals/feed` in a browser
3. Gaming sources (GamerPower, EpicBundle) are unaffected and will continue to deliver deals

The container health check only monitors poll cycle freshness — a single OzBargain fetch failure will not mark the container unhealthy unless all enabled sources fail across multiple cycles.
