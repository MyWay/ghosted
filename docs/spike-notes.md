# Spike notes: what is verified and what is not

The implementation was written without access to a live X session. The GraphQL response shapes in
`src/core/parse/*` come from knowledge of X's web app, not from captures, and the tests use
synthetic bodies from `tests/helpers.ts`. **Nothing here has run against real X traffic yet.**

## First run checklist (Phase 0, do this before trusting results)

1. `pnpm build`, load `.output/chrome-mv3` as an unpacked extension (or `pnpm build:firefox` and
   load `.output/firefox-mv3/manifest.json` via about:debugging).
2. Log in to x.com, open your profile, then `/<you>/following` and scroll to the bottom.
3. Open the popup. Capture health should turn green. If it is red ("X changed its response
   format"), the parser needs a fix: capture the response body (DevTools > Network > filter
   `Following`, copy the JSON), save it under `tests/fixtures/`, and adapt `parse/user.ts` /
   `parse/timeline.ts`.
4. Answer and record here:
   - [ ] Is the follows-you flag present on Following entries, and under which key
         (`legacy.followed_by`, `relationship_perspectives.followed_by`, other)?
   - [ ] Does the last page return zero entries, a repeated cursor, or a `0|` cursor?
   - [ ] Does X use fetch or XHR for these calls?
   - [ ] Is `UserByScreenName` fetched on a full load of `/<you>/followers`? (Assisted scans rely
         on it for a fresh expected count; counts older than 1h are ignored.)
   - [ ] Does X ever request the list with the top cursor (e.g. scrolling back up)? Handled as a
         side page either way, but worth confirming.
   - [ ] Does clicking Unfollow on x.com still call `/i/api/1.1/friendships/destroy.json` with
         `user_id` in the body? If not, "you unfollowed" events show as "left your following".
   - [ ] Does the list stop early for large accounts (server-side cap)?
   - [ ] Does lazy loading continue in a background tab? (Assisted scan assumes it does not.)
5. Scan twice with a real unfollow in between; confirm the event appears.

## Known gaps versus PLAN.md

- **DOM fallback (plan 5.4) is not implemented.** If the JSON format changes, capture stops and the
  popup shows an error rather than falling back to scraping `UserCell`.
- **Phase 6 (inactive check, slow unfollow) is not implemented**, by design (opt-in, risky).
- `likely_gone` is a heuristic: a follower who left within 3 days of also vanishing from your
  following list *without* you unfollowing them on x.com. Unfollows done on another device are not
  seen, so there it can still mislabel.
- If no fresh (< 1h) profile count exists when a scan ends, the count check is skipped and a
  stricter mass-removal guard applies (hold if more than max(5, 1%) would be removed).
- The page hook (`x-hook.content.ts`) and bridge have no automated tests; they need a jsdom or
  real-browser harness.
- No automated test loads the built extension in a browser; the hook -> bridge -> background path
  is only covered by build and type checks.
