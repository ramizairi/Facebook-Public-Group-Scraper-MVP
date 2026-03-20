# Facebook Public Group Scraper

Production-oriented Facebook public group scraper built with Node.js and Playwright. It is designed for local use first, with optional Docker and Apify support on top of the same codebase.

The scraper focuses on public groups only. It prefers structured data from the document and network surface, falls back to DOM extraction when needed, persists checkpoints, supports proxies and cookie-backed sessions, and can export a Gemini-generated XLSX workbook for each group.

## Highlights

- Public Facebook groups only
- Network-first extraction with DOM fallback
- Cookie-aware browser sessions from `cookies.json`
- Proxy support for single proxies and proxy pools
- Checkpointing, resume, and structured logs
- Group-specific output folders under `output/<groupId>/`
- Gemini-powered XLSX export written back into the same group folder
- Optional Apify Actor wrapper for cloud runs

## What The Project Produces

For each scraped group, the project writes a dedicated folder:

```text
output/<groupId>/
  output.json
  posts.json
  posts.jsonl
  checkpoint.json
  stats.json
  output.xlsx
  logs/
    run.log
  debug/
```

Files:

- `output.json`: lightweight export for downstream use
- `posts.json`: full normalized archive
- `posts.jsonl`: append-friendly line-delimited archive
- `checkpoint.json`: resume state
- `stats.json`: run metrics
- `output.xlsx`: Gemini-generated workbook, when analyzer is run
- `logs/run.log`: structured run log
- `debug/`: captured payload samples and failure metadata

## Scope

Supported:

- Public Facebook groups
- Local runs
- Docker runs
- Apify Actor deployment
- Cookie-backed sessions for groups you can already access in a normal browser session

Not supported:

- Private groups
- Login automation
- CAPTCHA or 2FA solving
- Official Graph API integrations

## How It Works

1. Opens the public group page in Playwright.
2. Warms up the Facebook session first to reduce cold-start login redirects.
3. Reads embedded document state and relevant network payloads.
4. Extracts posts from structured sources first.
5. Falls back to DOM extraction only when structured extraction stops yielding new posts.
6. Deduplicates and persists normalized posts continuously.
7. Optionally runs the Gemini analyzer on the group output and writes `output.xlsx` into the same group folder.

## Quick Start

Install dependencies:

```bash
npm install
npx playwright install chromium
```

Create your env file:

```bash
cp .env.example .env
```

Minimal `.env`:

```env
GROUP_URL=https://www.facebook.com/groups/123456789012345/
MAX_POSTS=100
RUNTIME_MINUTES=
COOKIES_FILE=
HEADLESS=true

PROXY_SERVER=
PROXY_USERNAME=
PROXY_PASSWORD=
PROXY_POOL_DIR=
PROXY_POOL_PROTOCOL=

GEMINI_API_KEY=
```

Run the scraper:

```bash
npm start
```

Run the analyzer:

```bash
npm run analyze:xlsx
```

If `GROUP_URL=https://www.facebook.com/groups/525468629029673/`, outputs will be written to:

```text
output/525468629029673/
```

## Common Commands

Scrape using `.env` defaults:

```bash
node src/index.js --max-posts 100
```

Scrape a one-off group:

```bash
node src/index.js --url "https://www.facebook.com/groups/..." --max-posts 100
```

Scrape with a cookies file:

```bash
node src/index.js --cookies-file ./cookies.json --max-posts 100
```

Force direct mode even if proxy settings exist:

```bash
node src/index.js --no-proxy --max-posts 100
```

Run proxy verification:

```bash
node src/index.js --test-proxy
```

Run on a schedule, then analyze:

```bash
node src/index.js \
  --schedule-total-minutes 120 \
  --schedule-interval-minutes 15 \
  --schedule-run-analyzer=true
```

Analyze a specific group folder:

```bash
node src/analyze/index.js --group-url "https://www.facebook.com/groups/525468629029673/"
```

## Cookies

You can preload browser cookies from a local JSON file with:

- `COOKIES_FILE=./cookies.json`
- or `--cookies-file ./cookies.json`

Supported formats:

- JSON array of cookies
- Storage-state object with top-level `cookies`

When a cookies file is present, the scraper keeps the session sticky and avoids the normal anonymous-session recycle strategy.

## Proxy Support

Supported modes:

- Single proxy:
  - `PROXY_SERVER`
  - `PROXY_USERNAME`
  - `PROXY_PASSWORD`
- Proxy pool:
  - `PROXY_POOL_DIR`
  - `PROXY_POOL_PROTOCOL`

Accepted proxy formats include:

- `host:port`
- `host:port:username:password`
- `socks5://username:password@host:port`

Useful scripts:

- `npm run start:proxy`
- `npm run start:no-proxy`
- `npm run test:proxy`

## Gemini XLSX Export

The analyzer reads `output.json` from the group folder, infers the group type, chooses the most useful dynamic spreadsheet columns for that group, and writes a workbook back into the same folder.

The workbook contains:

- Main analysis sheet
- `group_info` sheet
- `column_map` sheet

This makes the XLSX useful across different kinds of groups, not only ride-sharing groups.

## Docker

Build:

```bash
docker build -t facebook-public-group-scraper .
```

Run with Docker Compose:

```bash
DOCKER_UID=$(id -u) DOCKER_GID=$(id -g) docker compose build
DOCKER_UID=$(id -u) DOCKER_GID=$(id -g) docker compose run --rm scraper
```

Run without proxy:

```bash
DOCKER_UID=$(id -u) DOCKER_GID=$(id -g) docker compose run --rm scraper --no-proxy
```

Run the analyzer only:

```bash
DOCKER_UID=$(id -u) DOCKER_GID=$(id -g) docker compose run --rm scraper npm run analyze:xlsx
```

## Apify

This repository includes an Apify Actor wrapper:

- `.actor/actor.json`
- `.actor/input_schema.json`
- `.actor/dataset_schema.json`
- `main.js`

On Apify:

- Actor input replaces local `.env`
- Apify Proxy can be used instead of local proxy files
- dataset and key-value store outputs are supported
- the same codebase can run locally or inside Actor runtime

Deploy with the Apify CLI:

```bash
apify login
apify push
```

## Configuration

Core env vars for most runs:

- `GROUP_URL`
- `MAX_POSTS`
- `RUNTIME_MINUTES`
- `COOKIES_FILE`
- `HEADLESS`
- `PROXY_SERVER`
- `PROXY_USERNAME`
- `PROXY_PASSWORD`
- `PROXY_POOL_DIR`
- `PROXY_POOL_PROTOCOL`
- `GEMINI_API_KEY`

Advanced tuning is available for:

- scheduling
- session-state reuse
- proxy rotation and quarantine
- warmup and retry timing
- browser recycle thresholds
- Gemini batch size, model, and output settings

CLI flags override `.env`.

## npm Scripts

- `npm start`: universal entrypoint
- `npm run start:proxy`: run with proxy settings from `.env`
- `npm run start:no-proxy`: force direct mode
- `npm run start:scheduled`: run scheduled mode from `.env`
- `npm run test:proxy`: verify outbound proxy path
- `npm run analyze:xlsx`: generate the group workbook
- `npm test`: run the test suite

## Normalized Post Shape

Example `posts.json` item:

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

## Project Structure

- `src/config/`: env loading, CLI parsing, validation
- `src/browser/`: Playwright session boot, cookies, proxies, session state
- `src/extract/`: network/document parsing and DOM fallback
- `src/core/`: crawl loop, deduplication, metrics, checkpoints
- `src/output/`: logs and persisted artifacts
- `src/analyze/`: Gemini analysis and XLSX generation
- `src/apify/`: Actor wrapper and Apify-specific output handling
- `test/`: regression coverage for parser, config, analyzer, proxy, and support logic

## Known Fragility Points

- Facebook frequently changes markup and internal payload shapes.
- Logged-out visibility is inconsistent across groups, sessions, and IPs.
- Proxy quality matters a lot; some proxies can tunnel traffic but still expose a weak Facebook surface.
- DOM extraction is a fallback, not the primary source of truth.

## License

[MIT](LICENSE)
