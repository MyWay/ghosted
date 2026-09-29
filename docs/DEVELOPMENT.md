# Development

Chrome + Firefox MV3 extension built with WXT, Svelte 5, TypeScript and Dexie (IndexedDB).
It only observes the followers / following responses X's own web app loads; it never sends
requests to X.

```sh
pnpm install
pnpm dev             # Chrome with hot reload (pnpm dev:firefox for Firefox)
pnpm test            # unit tests (core logic, database, stats)
pnpm check           # type check
pnpm build           # .output/chrome-mv3
pnpm build:firefox   # .output/firefox-mv3
pnpm release         # tests + type check + store zips in .output/
```

- `src/core/`: parsing X responses, scan completeness rules, diffing (no browser APIs)
- `src/db/`: Dexie schema and repository
- `src/entrypoints/`: background, page hook, bridge, popup, dashboard, welcome page
- `docs/spike-notes.md`: what is still unverified against live X traffic
- `docs/PUBLISHING.md`: Chrome Web Store / Firefox Add-ons submission
