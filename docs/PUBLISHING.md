# Distributing Ghosted

`pnpm release` runs tests + type checks, then writes store-ready packages to `.output/`:

| File | Use |
|---|---|
| `ghosted-<ver>-chrome.zip` | Chrome Web Store upload (also works for Edge Add-ons) |
| `ghosted-<ver>-firefox.zip` | addons.mozilla.org (AMO) upload |
| `ghosted-<ver>-sources.zip` | AMO "source code" upload (required because the code is bundled) |

Bump `version` in `package.json` before every release; stores reject a re-used version.

## GitHub Releases (current distribution)

Ghosted ships through GitHub Releases only for now; the store sections below are for later.
`.github/workflows/release.yml` does the release when a version tag is pushed:

```sh
pnpm version patch        # bumps package.json, commits, tags v0.1.1
git push --follow-tags
```

The workflow checks that the tag matches `package.json`, runs `pnpm release`, signs the Firefox
build as an **unlisted** AMO add-on, and publishes a release with `ghosted-chrome.zip`,
`ghosted-firefox.xpi` and `ghosted-sources.zip`.

One-time setup:

1. Create an AMO account, then Developer Hub → Manage API Keys. The "JWT issuer" and "JWT secret"
   shown there are the only credentials the workflow needs; GitHub provides its own token.
2. In the GitHub repo: Settings → Environments → New environment `release`:
   - Deployment branches and tags → Selected → add tag rule `v*`.
   - Optionally Required reviewers → yourself, so every signing run waits for your click.
   - Environment secrets → add `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.
3. Settings → Rules → Rulesets: protect `main` (require a pull request) and restrict creating
   `v*` tags to yourself.

Pull requests from forks never see these secrets: `ci.yml` runs on `pull_request` with a
read-only token, and the release job only runs for `v*` tags. Keep it that way (never use
`pull_request_target`) and review PR changes to `.github/`, `package.json` and `pnpm-lock.yaml`
closely, since merged code is what the next release signs. If the AMO key leaks, revoke it in
Developer Hub and create a new one.

Without those secrets the workflow still builds, but creates a **draft** release with no `.xpi`,
so nothing half-finished goes public. `.github/workflows/ci.yml` runs tests, type checks and both
builds on every push to `main` and every pull request.

## Before the first submission

- **Name.** Store title is "Ghosted — Unfollower Tracker for X" (`manifest.name`); the toolbar and
  UI use the short name "Ghosted". Brand first, "for X" last is the pattern stores accept; never
  start the name with "X" or "Twitter". Search both stores for "Ghosted" before submitting.
- **Firefox id.** `ghosted@fastdrop.dev` in `wxt.config.ts`. Never change it after the first
  signed upload: Firefox treats a new id as a different add-on, and users lose their data.
- **Privacy policy.** Both stores require one for extensions that read site data. Host
  `docs/PRIVACY.md` somewhere public (a GitHub page is fine) and paste the URL.
- **Screenshots.** 1280×800 PNGs of the dashboard Overview, Timeline and popup.

## Chrome Web Store (Chrome, Brave, Edge via its own store)

1. Register at the Chrome Web Store Developer Dashboard (one-time US$5 fee).
2. New item → upload the chrome zip.
3. Privacy tab:
   - Single purpose: "Tracks changes to the user's own X followers and following lists."
   - Permission justifications:
     - `cookies`: read the X session id cookie to identify the user's own account.
     - `storage`/`unlimitedStorage`: local history.
     - `alarms`: scan reminders.
     - `notifications`: change alerts.
     - host access to x.com: read the follower lists the user opens.
   - Data usage: "Personally identifiable information / website content" collected, **not**
     transferred, **not** sold, used only for the single purpose.
4. Submit. Review usually takes a few days. Updates: upload a zip with a higher version.

## Firefox (addons.mozilla.org)

**Listed (public, searchable):** Developer Hub → Submit a New Add-on → "On this site" → upload
the firefox zip, then the sources zip, with build notes: `pnpm install && pnpm build:firefox`
(Node 20+, pnpm 9+).

**Unlisted (private, fastest):** same flow but choose "On your own". AMO signs it within minutes
and gives you a `.xpi` you can share directly; users open the file in Firefox to install it
permanently. Automate with `npx web-ext sign --channel unlisted --api-key ... --api-secret ...
--source-dir .output/firefox-mv3`.

Firefox users must allow access to x.com once. The welcome page opens on install and walks them
through it.

## Without a store

Share the chrome zip; users unzip it and use `chrome://extensions` → Developer mode → Load
unpacked. This works, but Chrome shows a "developer mode extensions" warning at startup and
there are no automatic updates.
