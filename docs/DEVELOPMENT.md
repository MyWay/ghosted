# Development

Chrome + Firefox MV3 extension built with WXT, Svelte 5, TypeScript and Dexie (IndexedDB).
It only observes the followers / following responses X's own web app loads; it never sends
requests to X.

```sh
pnpm install
pnpm dev             # Chrome with hot reload (pnpm dev:firefox for Firefox)
pnpm test            # unit tests (core logic, database, stats)
pnpm e2e             # builds, then checks webhook alerts in a real Chromium (see below)
pnpm check           # type check
pnpm build           # .output/chrome-mv3
pnpm build:firefox   # .output/firefox-mv3
pnpm release         # tests + type check + store zips in .output/
```

- `src/core/`: parsing X responses, scan completeness rules, diffing (no browser APIs)
- `src/db/`: Dexie schema and repository
- `src/entrypoints/`: background, page hook, bridge, popup, dashboard, welcome page
- `scripts/e2e-webhook.mjs`: loads the build into headless Chromium and checks webhook delivery, CORS,
  permissions and timeouts against a local server. Needs a Chromium (`npx playwright install chromium`,
  or set `CHROME=`); branded Chrome no longer loads unpacked extensions from the command line. Not run in CI.
- `docs/spike-notes.md`: what is still unverified against live X traffic
- `docs/PUBLISHING.md`: Chrome Web Store / Firefox Add-ons submission
