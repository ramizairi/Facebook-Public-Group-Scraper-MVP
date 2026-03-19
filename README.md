# Facebook Public Group Scraper MVP

Browser-backed Facebook public group scraper built with Node.js and Playwright. It targets public groups only, prefers structured data from the page/network surface, and uses DOM extraction only as a fallback.

The project now includes an Apify Actor wrapper on top of the existing scraper, so the same codebase can run locally or on Apify with Actor input, Apify Proxy, dataset output, key-value storage, and Apify-native scheduling.

## What It Does

- Reads `GROUP_URL` from `.env` by default and allows CLI overrides.
- Uses a cumulative output folder at `output/result` unless `--output-dir` is passed explicitly.
- Launches a Playwright Chromium browser with optional proxy support.
- Supports single-proxy mode or proxy-pool rotation from files such as `proxy/socket5/*.txt`.
- Warms up a logged-out Facebook session on `facebook.com` before opening the group URL to reduce cold-start login redirects.
- Captures relevant network/document payloads and extracts posts from embedded JSON or response bodies first.
- Falls back to `[role="feed"] [role="article"]` DOM parsing when structured extraction yields nothing new.
- Deduplicates posts by stable IDs and canonical URLs.
- Continuously writes filtered outputs as `posts.json` and `posts.jsonl`, plus legacy-style unfiltered outputs as `posts.unfiltered.json` and `posts.unfiltered.jsonl`, along with `stats.json`, `checkpoint.json`, logs, and debug artifacts.
- Supports resume mode with `--resume`.
- Supports proxy verification mode with `--test-proxy`.
- Includes a separate Gemini-to-XLSX analyzer that reads saved `posts.json` results and writes `output/xlsx/output.xlsx` without touching scraper runtime performance.

## Limitations

- Public Facebook groups only.
- No login automation.
- No private-group access.
- No CAPTCHA or 2FA handling.
- No official Graph API usage.
- Logged-out Facebook is fragile and can change without notice.
- Infinite-scroll feed responses are not guaranteed in logged-out mode, so the scraper treats embedded document state as a first-class structured source.
- Some fields are best-effort only: `authorId`, `createdAt`, and engagement counts may be `null`.

## Setup

1. Install dependencies:

```bash
npm install
npx playwright install chromium
```

2. Create `.env` from the example:

```bash
cp .env.example .env
```

3. Set at minimum:

```env
GROUP_URL=https://www.facebook.com/groups/123456789012345/
```

## Usage

Universal entrypoint:

```bash
npm start
```

Run with `.env` defaults:

```bash
node src/index.js --max-posts 100
```

By default, each run writes into the cumulative folder `output/result`.

Override the group URL for a one-off run:

```bash
node src/index.js --url "https://www.facebook.com/groups/..." --max-posts 100
```

Use a proxy:

```bash
node src/index.js \
  --proxy-server=http://host:port \
  --proxy-username=user \
  --proxy-password=pass
```

Use a proxy pool from files under `proxy/socket5/`:

```bash
node src/index.js --max-posts 100
```

Disable proxy usage even if `.env` contains proxy settings:

```bash
node src/index.js --no-proxy --max-posts 100
```

Accepted proxy line formats:

- `host:port`
- `host:port:username:password`
- `socks5://username:password@host:port`

Resume a previous run:

```bash
node src/index.js --resume
```

Set a runtime limit:

```bash
node src/index.js --runtime-minutes 60
```

Run the scraper every 15 minutes for 2 hours, then export the XLSX analysis once at the end:

```bash
node src/index.js \
  --schedule-total-minutes 120 \
  --schedule-interval-minutes 15 \
  --schedule-run-analyzer=true
```

Verify outbound IP through the configured proxy:

```bash
node src/index.js --test-proxy
```

Generate an XLSX analysis from the latest scrape result:

```bash
npm run analyze:xlsx
```

## Apify Actor

This repository now contains the files required for Apify Actor deployment:

- [.actor/actor.json](/home/rami/Desktop/facebook-groupes-scrapper/.actor/actor.json)
- [.actor/input_schema.json](/home/rami/Desktop/facebook-groupes-scrapper/.actor/input_schema.json)
- [.actor/dataset_schema.json](/home/rami/Desktop/facebook-groupes-scrapper/.actor/dataset_schema.json)
- [main.js](/home/rami/Desktop/facebook-groupes-scrapper/main.js)

### What Changes On Apify

- Actor input is loaded from the Apify input schema instead of `.env`.
- Apify Proxy is used through Actor input `proxyConfiguration`, so local proxy files are not required on the platform.
- Filtered normalized posts are pushed to the default dataset.
- Snapshots and artifacts are stored in the default key-value store:
  - `posts.json`
  - `posts.unfiltered.json`
  - `stats.json`
  - `checkpoint.json`
  - `OUTPUT`
  - `debug-*`
  - `analysis.rows.json` and `output.xlsx` when the analyzer runs

### Apify Deployment

Fastest local deployment path with the Apify CLI:

```bash
apify login
apify push
```

If you prefer automatic rebuilds, create a new empty Actor in Apify Console and link this GitHub repository as the Actor source.

### Recommended Apify Usage

- Use Apify platform schedules for recurring cloud runs.
- Leave internal `scheduleTotalMinutes` empty unless you specifically want one long Actor run with multiple scrape cycles.
- Set `GEMINI_API_KEY` in the Actor environment variables if you enable the XLSX analyzer.
- Configure proxies from the Actor input `proxyConfiguration` field. If you use Apify Proxy, you can optionally set `proxyCountryCode` too.

### Local Actor Smoke Test

If you want to test the Actor wrapper locally before pushing:

```bash
apify run
```

The Actor runtime uses a separate local work directory for checkpoints and session state, so it does not reuse your normal local `output/result` folder.

## Docker

Build the image:

```bash
docker build -t facebook-public-group-scraper .
```

Run with your local `.env` and write outputs back to `./output` on the host:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env-file .env \
  -v "$(pwd)/output:/app/output" \
  facebook-public-group-scraper \
  --max-posts 100
```

Use Docker Compose:

```bash
DOCKER_UID=$(id -u) DOCKER_GID=$(id -g) docker compose run --rm scraper --max-posts 100
```

Notes:

- The container does not copy your local `.env` into the image.
- The default cumulative result folder is `/app/output/result` in the container and maps back to `./output/result` on the host.
- When you bind-mount `./output`, run the container with your host UID/GID so the scraper can write logs and JSON files without root-owned permission issues.
- If you still need `sudo` for Docker access, export the variables first and then use `sudo -E docker compose ...`.
- Docker support is additive only; the local Node.js workflow remains unchanged.
- On Apify, the same Docker image starts through [main.js](/home/rami/Desktop/facebook-groupes-scrapper/main.js), which switches automatically between the local CLI workflow and the Actor workflow based on the runtime environment.

## Config

Supported `.env` variables:

- `GROUP_URL`
- `MAX_POSTS`
- `RUNTIME_MINUTES`
- `SCHEDULE_TOTAL_MINUTES`
- `SCHEDULE_INTERVAL_MINUTES`
- `SCHEDULE_RUN_ANALYZER`
- `SESSION_STATE_ENABLED`
- `SESSION_STATE_DIR`
- `SESSION_STATE_TTL_HOURS`
- `SESSION_STATE_MIN_POSTS_TO_SAVE`
- `SESSION_STATE_RESET_ON_BLOCK`
- `PROXY_SERVER`
- `PROXY_USERNAME`
- `PROXY_PASSWORD`
- `PROXY_POOL_DIR`
- `PROXY_POOL_PROTOCOL`
- `PROXY_MAX_SESSIONS_PER_PROXY`
- `PROXY_QUARANTINE_MINUTES`
- `PROXY_FAILURE_SCORE_THRESHOLD`
- `PROXY_LOW_YIELD_POST_THRESHOLD`
- `PROXY_ROTATE_ON_RETRY`
- `PROXY_ROTATE_ON_RECYCLE`
- `PROXY_ROTATE_ON_BLOCK`
- `STARTUP_RETRIES`
- `STARTUP_SETTLE_MS`
- `HOME_WARMUP`
- `HOME_WARMUP_DELAY_MS`
- `MIN_DELAY_MS`
- `MAX_DELAY_MS`
- `NO_NEW_POST_CYCLES`
- `NETWORK_STALL_RECYCLE_CYCLES`
- `MAX_NETWORK_STALL_RESTARTS`
- `BROWSER_RECYCLE_REQUESTS`
- `BROWSER_LOCALE`
- `BROWSER_TIMEZONE`
- `USER_AGENT`
- `HEADLESS`
- `PROXY_TEST_URL`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_BATCH_SIZE`
- `GEMINI_TEMPERATURE`
- `GEMINI_MAX_OUTPUT_TOKENS`
- `ANALYZER_INPUT_DIR`
- `ANALYZER_INPUT_FILE`
- `ANALYZER_USE_UNFILTERED_POSTS`
- `MAX_POSTS_TO_ANALYZE`
- `ANALYZER_OUTPUT_DIR`
- `ANALYZER_OUTPUT_FILE`

Supported CLI flags:

- `--url`
- `--max-posts`
- `--runtime-minutes`
- `--schedule-total-minutes`
- `--schedule-interval-minutes`
- `--schedule-run-analyzer=true|false`
- `--session-state-enabled=true|false`
- `--session-state-dir`
- `--session-state-ttl-hours`
- `--session-state-min-posts-to-save`
- `--session-state-reset-on-block=true|false`
- `--output-dir`
- `--no-proxy`
- `--proxy-server`
- `--proxy-username`
- `--proxy-password`
- `--proxy-pool-dir`
- `--proxy-pool-protocol`
- `--proxy-max-sessions-per-proxy`
- `--proxy-quarantine-minutes`
- `--proxy-failure-score-threshold`
- `--proxy-low-yield-post-threshold`
- `--proxy-rotate-on-retry=true|false`
- `--proxy-rotate-on-recycle=true|false`
- `--proxy-rotate-on-block=true|false`
- `--resume`
- `--test-proxy`
- `--browser-recycle-requests`
- `--home-warmup=true|false`
- `--home-warmup-delay-ms`
- `--min-delay-ms`
- `--max-delay-ms`
- `--network-stall-recycle-cycles`
- `--max-network-stall-restarts`
- `--headless=true|false`

CLI flags override `.env`.

Useful npm scripts:

- `npm run start:proxy`: run with whatever proxy settings are currently in `.env`
- `npm run start:no-proxy`: force a direct run without proxy or proxy pool
- `npm run start:scheduled`: run the main entrypoint with schedule settings from `.env`
- `npm run test:proxy`: verify outbound IP through the current proxy configuration
- `npm run analyze:xlsx`: analyze the cumulative saved result folder with Gemini and export `output/xlsx/output.xlsx`

## Output

Each run writes into the configured output directory:

- default path: `output/result`
- `posts.json`: full normalized post array
- `posts.jsonl`: append-friendly line-delimited post stream
- `posts.unfiltered.json`: legacy-style post array with sparse/null-heavy posts preserved
- `posts.unfiltered.jsonl`: append-friendly legacy line stream
- `stats.json`: run metrics and throughput
- `checkpoint.json`: resumable state with collected posts
- `logs/run.log`: structured JSON logs
- `debug/`: sampled payloads, failure screenshots, HTML snapshots, and recent network traces

Analyzer output:

- `output/xlsx/output.xlsx`: spreadsheet with direct fields from `posts.json` plus Gemini-derived Tunisian ride-share fields

### Normalized Post Schema

```json
{
  "id": "26652886501003239",
  "url": "https://www.facebook.com/groups/364609516924296/posts/26652886501003239/",
  "groupUrl": "https://www.facebook.com/groups/364609516924296/",
  "authorName": "Example Author",
  "authorId": "1000123456789",
  "createdAt": "2026-03-18T01:23:45.000Z",
  "text": "Post body text",
  "media": [
    {
      "type": "image",
      "url": "https://example-cdn/image.jpg"
    }
  ],
  "reactionCount": 12,
  "commentCount": 4,
  "shareCount": 1,
  "sourceType": "network",
  "rawFragment": {
    "source": "document-embedded-json",
    "reference": "26652886501003239:document-embedded-json"
  }
}
```

## Architecture

- `src/config/`: `.env` loading, CLI parsing, config validation
- `src/browser/`: Playwright session launch and proxy test mode
- `src/extract/`: network tap, response classifier, embedded JSON parser, DOM fallback
- `src/core/`: crawl loop, block detection, normalization, dedup, checkpointing, metrics
- `src/output/`: structured logging and artifact persistence
- `src/utils/`: URL normalization, delay helpers, JSON safety, redaction helpers

## Fragility Points

- Facebook often changes internal response shapes, embedded JSON formats, and logged-out feed behavior.
- The login overlay may still appear even when posts remain accessible.
- Feed expansion after initial load may stop yielding structured responses, which is why DOM fallback exists.
- Relative timestamps shown in DOM are not reliable enough to convert to absolute timestamps.

## Future Extensions

- Add fixtures from more real-world group layouts and pinned/featured post variants.
- Add richer engagement parsing from additional GraphQL or Relay shapes when available.
- Add optional storage backends beyond local JSON/JSONL.
- Add stronger cursor-like progress tracking if Facebook exposes stable pagination surfaces again.
