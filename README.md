# Facebook Public Group Scraper MVP

Browser-backed Facebook public group scraper built with Node.js and Playwright. It targets public groups only, prefers structured data from the page/network surface, and uses DOM extraction only as a fallback.

## What It Does

- Reads `GROUP_URL` from `.env` by default and allows CLI overrides.
- Treats blank optional `.env` values such as `OUTPUT_DIR=` as unset and falls back to defaults.
- Launches a Playwright Chromium browser with optional proxy support.
- Warms up a logged-out Facebook session on `facebook.com` before opening the group URL to reduce cold-start login redirects.
- Captures relevant network/document payloads and extracts posts from embedded JSON or response bodies first.
- Falls back to `[role="feed"] [role="article"]` DOM parsing when structured extraction yields nothing new.
- Deduplicates posts by stable IDs and canonical URLs.
- Continuously writes `posts.json`, `posts.jsonl`, `stats.json`, `checkpoint.json`, logs, and debug artifacts.
- Supports resume mode with `--resume`.
- Supports proxy verification mode with `--test-proxy`.

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

Run with `.env` defaults:

```bash
node src/index.js --max-posts 100
```

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

Resume a previous run:

```bash
node src/index.js --resume
```

Set a runtime limit:

```bash
node src/index.js --runtime-minutes 60
```

Verify outbound IP through the configured proxy:

```bash
node src/index.js --test-proxy
```

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
- Relative output paths resolve under `/app` in the container, so the default blank `OUTPUT_DIR=` still maps into the mounted `./output` directory on the host.
- When you bind-mount `./output`, run the container with your host UID/GID so the scraper can write logs and JSON files without root-owned permission issues.
- If you still need `sudo` for Docker access, export the variables first and then use `sudo -E docker compose ...`.
- Docker support is additive only; the local Node.js workflow remains unchanged.

## Config

Supported `.env` variables:

- `GROUP_URL`
- `MAX_POSTS`
- `RUNTIME_MINUTES`
- `OUTPUT_DIR`
- `PROXY_SERVER`
- `PROXY_USERNAME`
- `PROXY_PASSWORD`
- `STARTUP_RETRIES`
- `STARTUP_SETTLE_MS`
- `HOME_WARMUP`
- `HOME_WARMUP_DELAY_MS`
- `MIN_DELAY_MS`
- `MAX_DELAY_MS`
- `NO_NEW_POST_CYCLES`
- `BROWSER_RECYCLE_REQUESTS`
- `BROWSER_LOCALE`
- `BROWSER_TIMEZONE`
- `USER_AGENT`
- `HEADLESS`
- `PROXY_TEST_URL`

Supported CLI flags:

- `--url`
- `--max-posts`
- `--runtime-minutes`
- `--output-dir`
- `--proxy-server`
- `--proxy-username`
- `--proxy-password`
- `--resume`
- `--test-proxy`
- `--browser-recycle-requests`
- `--home-warmup=true|false`
- `--home-warmup-delay-ms`
- `--min-delay-ms`
- `--max-delay-ms`
- `--headless=true|false`

CLI flags override `.env`.

## Output

Each run writes into the configured output directory:

- `posts.json`: full normalized post array
- `posts.jsonl`: append-friendly line-delimited post stream
- `stats.json`: run metrics and throughput
- `checkpoint.json`: resumable state with collected posts
- `logs/run.log`: structured JSON logs
- `debug/`: sampled payloads, failure screenshots, HTML snapshots, and recent network traces

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
