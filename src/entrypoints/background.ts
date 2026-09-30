import { browser } from 'wxt/browser';
import { ownerIdFromTwid } from '../core/owner';
import { isUnfollowUrl, opToKind, parseOperationUrl, parseUnfollow } from '../core/parse/operations';
import { parseApiErrors, parseTimelinePage } from '../core/parse/timeline';
import { numericPaths, parseProfile, profileResult } from '../core/parse/user';
import type { ListKind } from '../core/types';
import { Repo, migrateLegacyDb } from '../db/repo';
import type {
  BridgeReadyReply,
  CaptureReply,
  CommandReply,
  ToBackground,
} from '../messages';
import { notifyEvents, sendBrowser, testChannel } from '../notify';
import { refreshBadge } from '../notify/badge';
import { PACES, asPace, randomIn } from '../core/pace';
import {
  PROFILE_WAIT_MS,
  advanceToList,
  afterKindDone,
  answerBridgeReady,
  newAutoScan,
  urlFor,
  type AutoScan,
} from '../core/autoscan';

const repo = new Repo();

// Long enough for a slow check of a large account.
const AUTOSCAN_TTL_MS = 3 * 60 * 60 * 1000;
const NEXT_LIST_ALARM = 'autoscan-next-list';
const DEFAULT_REMINDER_HOURS = 24;

/** Serialize capture handling so page batches never interleave their DB transactions. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function currentOwnerId(): Promise<string | undefined> {
  for (const url of ['https://x.com', 'https://twitter.com']) {
    try {
      const cookie = await browser.cookies.get({ url, name: 'twid' });
      const id = ownerIdFromTwid(cookie?.value);
      if (id) return id;
    } catch {
      /* try the next origin */
    }
  }
  return undefined;
}

async function setHealth(patch: Record<string, unknown>) {
  const prev = await repo.getSetting<Record<string, unknown>>('health', {});
  await repo.setSetting('health', { ...prev, ...patch });
}

async function handleCapture(msg: Extract<ToBackground, { type: 'capture' }>, tabId?: number): Promise<CaptureReply> {
  const now = Date.now();
  const info = parseOperationUrl(msg.url);
  const unfollow = !info && isUnfollowUrl(msg.url);
  if (!info && !unfollow) return { handled: false, ignored: 'irrelevant' };

  const ownerId = await currentOwnerId();
  if (!ownerId) return { handled: false, ignored: 'unknown-owner' };
  if ((await repo.getSetting('ownerId', undefined)) !== ownerId) await repo.setSetting('ownerId', ownerId);

  if (unfollow) {
    // You clicked Unfollow on x.com: lets the diff tell "you unfollowed" from "account vanished".
    const userId = msg.status >= 200 && msg.status < 300 ? parseUnfollow(msg.url, msg.requestBody, msg.body) : null;
    if (userId) await repo.recordMyUnfollow(ownerId, userId, now);
    return { handled: false, ignored: 'irrelevant' };
  }
  if (!info) return { handled: false, ignored: 'irrelevant' };

  if (info.op === 'UserByScreenName') {
    const profile = msg.body ? parseProfile(msg.body) : null;
    if (profile && profile.id === ownerId) {
      await repo.setProfileCounts(ownerId, profile.followersCount, profile.followingCount, now);
      await repo.setSetting('ownerHandle', profile.handle);
      // Counts missing means X changed where it keeps them: record the response's shape (field
      // names only, no values) so it can be found and fixed from the diagnostics.
      const missing = profile.followersCount === undefined || profile.followingCount === undefined;
      await setHealth({ profileShape: missing ? numericPaths(profileResult(msg.body)) : null });
      // An assisted check is waiting on the profile page for this count: now open the list.
      await moveToList(tabId);
    }
    return { handled: true, ignored: 'irrelevant' };
  }

  const kind = opToKind(info.op);
  if (!kind) return { handled: false, ignored: 'irrelevant' };
  if (info.userId !== ownerId) return { handled: false, ignored: 'not-owner' };

  const expected = await repo.expectedCount(ownerId, kind, now);

  if (msg.status === 429 || msg.status === 403) {
    await repo.failCurrentScan(ownerId, kind, `HTTP ${msg.status} from X`, now);
    await setHealth({ lastRateLimitAt: now });
    return { handled: true, kind, status: 'error', reason: `HTTP ${msg.status}`, rateLimited: true, expected };
  }

  const apiError = parseApiErrors(msg.body);
  const page = msg.status >= 200 && msg.status < 300 && msg.body ? parseTimelinePage(msg.body) : null;
  if (!page && apiError) {
    // X answered with an error payload (often a 200 rate limit), not a format change.
    await repo.failCurrentScan(ownerId, kind, `X error: ${apiError.message}`, now);
    if (apiError.rateLimited) await setHealth({ lastRateLimitAt: now });
    return { handled: true, kind, status: 'error', reason: apiError.message, rateLimited: apiError.rateLimited, expected };
  }
  if (!page) {
    // Unrecognised body: never diff, never guess. Surface it in the health indicator.
    await repo.failCurrentScan(ownerId, kind, 'unrecognised response shape', now);
    await setHealth({ lastParseError: { at: now, op: info.op, status: msg.status } });
    return { handled: true, kind, status: 'error', reason: 'unrecognised response shape', expected };
  }

  const result = await repo.ingestPage({ ownerId, kind, requestCursor: info.cursor, page, now });
  await setHealth({ lastCaptureAt: now, lastParseError: null });
  if (result.committed?.events.length) {
    await notifyEvents(result.committed.events);
    await refreshBadge(repo);
  }
  return { handled: true, kind, status: result.status, reason: result.reason, collected: result.collected, expected };
}

async function startScan(kinds: ListKind[]): Promise<CommandReply> {
  const handle = await repo.getSetting<string | undefined>('ownerHandle', undefined);
  if (!handle) return { ok: false, error: 'Open x.com once while logged in so the extension can learn your handle.' };
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  const onX = active?.id !== undefined && /^https:\/\/(x|twitter)\.com\//.test(active.url ?? '');
  // Placeholder tab id: the real one is known only after the tab is opened.
  const draft = newAutoScan(-1, kinds, handle, Date.now());
  const url = urlFor(draft);
  const tab = onX ? await browser.tabs.update(active.id!, { url }) : await browser.tabs.create({ url, active: true });
  if (tab?.id === undefined) return { ok: false, error: 'Could not open a tab.' };
  await browser.storage.session.set({ autoscan: { ...draft, tabId: tab.id } });
  return { ok: true };
}

async function getAutoScan(): Promise<AutoScan | undefined> {
  const { autoscan } = await browser.storage.session.get('autoscan');
  const scan = autoscan as AutoScan | undefined;
  if (scan && Date.now() - scan.startedAt > AUTOSCAN_TTL_MS) {
    await browser.storage.session.remove('autoscan');
    return undefined;
  }
  return scan;
}

/** Profile phase is over (count captured, or we stopped waiting): send the tab to the list page. */
async function moveToList(tabId?: number, step?: number) {
  const next = advanceToList(await getAutoScan(), tabId, Date.now(), step);
  if (!next) return;
  await browser.storage.session.set({ autoscan: next });
  await browser.tabs.update(next.tabId, { url: urlFor(next) }).catch(() => {});
}

async function handleBridgeReady(msg: { path: string }, tabId: number | undefined): Promise<BridgeReadyReply> {
  const scan = await getAutoScan();
  const answer = answerBridgeReady(scan, tabId, msg.path);
  // If X never sends the profile count (cached, or the request changed), do not hang: carry on without it.
  // The timer only applies to this profile step; a later one has its own.
  if (answer.waitForProfile && scan) {
    const step = scan.startedAt;
    setTimeout(() => void moveToList(tabId, step), PROFILE_WAIT_MS);
  }
  return { autoscroll: answer.autoscroll, pace: asPace(await repo.getSetting('pace', undefined)) };
}

async function handleScanFinished(msg: Extract<ToBackground, { type: 'scan-finished' }>) {
  const scan = await getAutoScan();
  if (!scan) return;
  const aborted = msg.outcome === 'stopped' || msg.outcome === 'rate-limited' || msg.outcome === 'timeout';
  const next = aborted ? null : afterKindDone(scan, Date.now());
  if (next) {
    await browser.storage.session.set({ autoscan: next });
    // Small pause so two full scans are not back-to-back.
    const wait = randomIn(PACES[asPace(await repo.getSetting('pace', undefined))].betweenListsMs);
    // The background script can be stopped after ~30s idle, so long pauses use an alarm, not a timer.
    if (wait >= 30_000) browser.alarms.create(NEXT_LIST_ALARM, { when: Date.now() + wait });
    else setTimeout(() => void openNextList(), wait);
    return;
  }
  await browser.storage.session.remove('autoscan');
  if (msg.outcome === 'rate-limited')
    await sendBrowser('Ghosted', 'X is limiting requests, so the check stopped. Try again in about 15 minutes, or choose a slower check speed in Settings.');
}

async function openNextList() {
  const scan = await getAutoScan();
  if (scan) await browser.tabs.update(scan.tabId, { url: urlFor(scan) }).catch(() => {});
}

async function checkScanDue() {
  const ownerId = await repo.getSetting<string | undefined>('ownerId', undefined);
  if (!ownerId) return;
  const hours = await repo.getSetting('reminderHours', DEFAULT_REMINDER_HOURS);
  if (!hours) return;
  const last = await repo.lastCommit(ownerId, 'following');
  const stale = !last || Date.now() - (last.endedAt ?? 0) > hours * 3_600_000;
  const snoozedUntil = await repo.getSetting('snoozedUntil', 0);
  if (stale && Date.now() > snoozedUntil) {
    await sendBrowser('Ghosted', 'Time for a check. Click to see who unfollowed you.', 'scan-due');
    await repo.setSetting('snoozedUntil', Date.now() + hours * 3_600_000 / 2);
  }
}

export default defineBackground(() => {
  void migrateLegacyDb(repo.db)
    .catch(() => {})
    .then(() => refreshBadge(repo))
    .catch(() => {});

  browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const msg = raw as ToBackground;
    const respond = (p: Promise<unknown>) => {
      p.then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
      return true;
    };
    switch (msg?.type) {
      case 'capture':
        return respond(enqueue(() => handleCapture(msg, sender.tab?.id)));
      case 'bridge-ready':
        return respond(handleBridgeReady(msg, sender.tab?.id));
      case 'owner-handle':
        return respond(repo.setSetting('ownerHandle', msg.handle).then(() => ({ ok: true })));
      case 'scan-finished':
        return respond(handleScanFinished(msg).then(() => ({ ok: true })));
      case 'start-scan':
        return respond(startScan(msg.kinds));
      case 'resolve-review':
        return respond(
          enqueue(async () => {
            const r = await repo.resolveReview(msg.scanId, msg.accept);
            if (r?.events.length) {
              await notifyEvents(r.events);
              await refreshBadge(repo);
            }
            return { ok: true };
          }),
        );
      case 'test-notify':
        return respond(testChannel(msg.channel).then(() => ({ ok: true })));
      default:
        return false;
    }
  });

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
  });

  browser.alarms.create('stale-sessions', { periodInMinutes: 5 });
  browser.alarms.create('scan-due', { periodInMinutes: 60 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'stale-sessions') void enqueue(() => repo.abandonStale(Date.now()));
    if (alarm.name === 'scan-due') void checkScanDue();
    if (alarm.name === NEXT_LIST_ALARM) void openNextList();
  });

  browser.notifications.onClicked.addListener((id) => {
    if (id === 'scan-due') void startScan(['following', 'followers']);
    browser.notifications.clear(id);
  });
});
