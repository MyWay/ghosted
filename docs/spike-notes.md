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
   - [ ] Is `UserByScreenName` fetched when `/<you>` loads? Assisted checks now open your profile
         before each list to get a fresh follower/following count (the list page alone did not
         reliably provide one). If it is not sent, the check waits 8s and continues without a count.
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
- If no fresh (< 1h) profile count exists when a scan ends (for example a passive scroll without a
  profile visit), the count check is skipped and a stricter mass-removal guard applies (hold if more
  than max(5, 1%) would be removed). Assisted checks avoid this by visiting the profile first.
- The list is usually shorter than X's follower counter (about 1-2% in one real account), so the
  completeness threshold (default 90%, changeable in Settings) is checked against the listed accounts
  plus any marked unavailable. Truncation is also caught by the cursor-chain checks and by the
  mass-removal review guard.
- No automated test in the repository loads the built extension in a browser. The profile-first flow
  was checked once by an end-to-end test in headless Chromium against a mocked x.com (page
  order, saved counts, no false review hold). That mock follows this project's own assumptions about
  X's responses, so it does not replace the checklist above.
