import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProfileChecks } from '../src/checks';
import { CHECK_WAIT_MS, MAX_CHECKS, advanceToList, newAutoScan, readProfile, type AutoScan } from '../src/core/autoscan';
import type { ParsedPage } from '../src/core/types';
import { MAX_CHECK_ATTEMPTS, PENDING_MAX_MS, Repo } from '../src/db/repo';
import { AppDB, type EventRow } from '../src/db/schema';
import type { ChecksDone } from '../src/messages';
import { mkUsers, userEntry, type FakeUser } from './helpers';

const OWNER = '999';
const TAB = 7;
let n = 0;

/** A UserByScreenName body for `u`, in either of X's user shapes. */
const profileBody = (u: FakeUser, variant: 'legacy' | 'core' = 'core') => ({
  data: { user: { result: userEntry(u, variant).content.itemContent.user_results.result } },
});

function setup() {
  const repo = new Repo(new AppDB(`checks-${n++}`));
  let clock = 1_000_000;
  let stored: AutoScan | undefined;
  const timers: Array<{ fn: () => Promise<void>; ms: number }> = [];
  const opened: string[] = [];
  const notified: EventRow[][] = [];
  const told: ChecksDone[] = [];
  let limited = 0;
  const checks = new ProfileChecks({
    repo,
    now: () => clock,
    load: async () => stored,
    save: async (s) => void (stored = s ?? undefined),
    open: async (tabId, url) => void opened.push(`${tabId} ${url}`),
    later: (fn, ms) => void timers.push({ fn, ms }),
    pause: async () => 2000,
    notify: (_owner, events) => void notified.push(events),
    tell: async (_tab, msg) => void told.push(msg),
    rateLimited: async () => void limited++,
  });

  /** Run every timer due so far, oldest first (timers they schedule wait for the next call). */
  const runTimers = async () => {
    const due = timers.splice(0);
    for (const t of due) {
      clock += t.ms;
      await t.fn();
    }
  };

  const toPage = (users: FakeUser[], bottomCursor?: string): ParsedPage => ({
    users: users.map((u) => ({ id: u.id, handle: u.handle, name: u.handle })),
    bottomCursor,
    warnings: 0,
    unavailable: 0,
  });
  /** A followers scan from an assisted check, with X's count `count`. */
  const scan = async (users: FakeUser[], count: number) => {
    clock += 60_000;
    await repo.setProfileCounts(OWNER, count, undefined, clock);
    await repo.ingestPage({ ownerId: OWNER, kind: 'followers', page: toPage(users, 'end|1'), now: clock, verify: true });
    await repo.ingestPage({ ownerId: OWNER, kind: 'followers', requestCursor: 'end|1', page: toPage([]), now: clock, verify: true });
  };
  /** Hold followers `keep`+1..`total` as departures awaiting a check (missed by two scans). */
  const hold = async (total: number, keep: number) => {
    await scan(mkUsers(1, total), total);
    await scan(mkUsers(1, keep), total);
    await scan(mkUsers(1, keep), total);
  };
  /** The profile being checked now. */
  const current = () => {
    const head = stored?.queue?.[0];
    if (!head) throw new Error('no profile being checked');
    return { id: head.userId, handle: head.handle };
  };
  /** The lists of a check are done, as the background has it when the last list finishes. */
  const listsDone = () => advanceToList(newAutoScan(TAB, ['followers'], 'me', clock), TAB, clock)!;

  return {
    repo,
    checks,
    timers,
    opened,
    notified,
    told,
    runTimers,
    hold,
    listsDone,
    scan: () => stored,
    current,
    limited: () => limited,
    events: () => repo.recentEvents(OWNER),
    pending: () => repo.pendingDepartures(OWNER),
  };
}

let t: ReturnType<typeof setup>;
beforeEach(async () => {
  t = setup();
  await t.repo.setSetting('ownerId', OWNER);
});

describe('readProfile', () => {
  const ann = { id: '1', handle: 'ann' };
  it('reads "follows you" from either user shape', () => {
    expect(readProfile(200, profileBody({ ...ann, followedBy: true }, 'core'), '1')).toBe('follows');
    expect(readProfile(200, profileBody({ ...ann, followedBy: true }, 'legacy'), '1')).toBe('follows');
    expect(readProfile(200, profileBody({ ...ann, followedBy: false }), '1')).toBe('left');
  });
  it('no flag in the response is no answer, not a departure', () => {
    expect(readProfile(200, profileBody(ann), '1')).toBe('unknown');
  });
  it('another account, or no user at all, is not about this profile', () => {
    expect(readProfile(200, profileBody({ ...ann, followedBy: false }), '2')).toBeNull();
    expect(readProfile(200, { data: { user: { result: { __typename: 'UserUnavailable' } } } }, '1')).toBeNull();
    expect(readProfile(200, null, '1')).toBeNull();
  });
  it('spots X limiting requests', () => {
    expect(readProfile(429, null, '1')).toBe('rate-limited');
    expect(readProfile(403, null, '1')).toBe('rate-limited');
    expect(readProfile(200, { errors: [{ code: 88, message: 'Rate limit exceeded' }] }, '1')).toBe('rate-limited');
  });
});

describe('profile checks', () => {
  it('nothing held: no checks, the check ends with the lists', async () => {
    await t.hold(100, 100);
    expect(await t.checks.start(t.listsDone())).toBe(0);
    expect(t.scan()).toBeUndefined();
    expect(t.timers).toEqual([]);
  });

  it('visits each held follower in turn, with a pause, and alerts once about those who left', async () => {
    await t.hold(100, 97); // 98, 99, 100 held
    expect(await t.checks.start(t.listsDone())).toBe(3);
    expect(t.opened).toEqual([]);
    expect(t.timers.map((x) => x.ms)).toEqual([2000]);
    await t.runTimers();
    const [a, b, c] = t.scan()!.queue!.map((q) => q.userId);
    expect([a, b, c].sort()).toEqual(['100', '98', '99']);
    expect(t.opened).toEqual([`${TAB} https://x.com/user${a}`]);

    await t.checks.onProfile(TAB, 200, profileBody({ ...t.current(), followedBy: true }));
    await t.runTimers();
    expect(t.opened.at(-1)).toBe(`${TAB} https://x.com/user${b}`);

    await t.checks.onProfile(TAB, 200, profileBody({ ...t.current(), followedBy: false }));
    await t.runTimers();
    expect(t.opened.at(-1)).toBe(`${TAB} https://x.com/user${c}`);

    // The third profile never answers.
    t.checks.pageReady(t.scan()!);
    expect(t.timers.map((x) => x.ms)).toEqual([CHECK_WAIT_MS]);
    await t.runTimers();

    expect(t.scan()).toBeUndefined();
    expect(t.told).toEqual([{ type: 'checks-done' }]);
    expect(t.notified.map((batch) => batch.map((e) => `${e.type}:${e.userId}:${e.reason}`))).toEqual([[`LOST_FOLLOWER:${b}:unfollowed`]]);
    expect((await t.events()).map((e) => e.userId)).toEqual([b]);
    // The first still follows (hidden by X); the third waits for another attempt next check.
    expect(await t.pending()).toMatchObject([{ userId: c, attempts: 1 }]);
    const members = await t.repo.listMembers(OWNER, 'followers');
    expect(members.find((m) => m.userId === a)).toMatchObject({ missing: true, checkedAt: expect.any(Number) });
    expect(members.find((m) => m.userId === b)).toBeUndefined();
  });

  it('a timeout after the profile answered changes nothing', async () => {
    await t.hold(100, 98);
    await t.checks.start(t.listsDone());
    await t.runTimers();
    const [first, second] = t.scan()!.queue!.map((q) => q.userId);
    t.checks.pageReady(t.scan()!); // timeout for the first armed
    await t.checks.onProfile(TAB, 200, profileBody({ ...t.current(), followedBy: true }));
    // Now: the late timeout and the pause before the second.
    expect(t.timers).toHaveLength(2);
    await t.runTimers();
    expect(t.scan()?.queue?.map((q) => q.userId)).toEqual([second]);
    expect(await t.pending()).toMatchObject([{ userId: second, attempts: 0 }]);
    expect(await t.pending()).not.toContainEqual(expect.objectContaining({ userId: first }));
  });

  it('ignores responses for other accounts and from other tabs', async () => {
    await t.hold(100, 99);
    await t.checks.start(t.listsDone());
    await t.runTimers();
    await t.checks.onProfile(TAB, 200, profileBody({ id: '3', handle: 'user3', followedBy: false }));
    await t.checks.onProfile(TAB + 1, 200, profileBody({ id: '100', handle: 'user100', followedBy: false }));
    await t.checks.onProfile(TAB + 1, 429, null);
    expect(t.scan()?.queue?.map((q) => q.userId)).toEqual(['100']);
    expect(await t.events()).toEqual([]);
    expect(t.limited()).toBe(0);
  });

  it('a rate limit stops the checks and keeps everyone unchecked held', async () => {
    await t.hold(100, 97);
    await t.checks.start(t.listsDone());
    await t.runTimers();
    const [first, ...rest] = t.scan()!.queue!.map((q) => q.userId);
    await t.checks.onProfile(TAB, 200, profileBody({ ...t.current(), followedBy: false }));
    await t.runTimers();
    await t.checks.onProfile(TAB, 429, null);
    expect(t.limited()).toBe(1);
    expect(t.scan()).toBeUndefined();
    expect(t.told).toEqual([{ type: 'checks-done', rateLimited: true }]);
    // The one checked before the limit is reported; the rest wait, attempts untouched.
    expect(t.notified.map((batch) => batch.map((e) => e.userId))).toEqual([[first]]);
    expect((await t.pending()).map((p) => [p.userId, p.attempts]).sort()).toEqual(rest.map((id) => [id, 0]).sort());
    // Nothing more happens afterwards.
    await t.runTimers();
    expect(t.opened).toHaveLength(2);
  });

  it('Stop keeps everyone unchecked held', async () => {
    await t.hold(100, 98);
    await t.checks.start(t.listsDone());
    await t.runTimers();
    await t.checks.stop();
    expect(t.scan()).toBeUndefined();
    expect(t.notified).toEqual([]);
    expect((await t.pending()).map((p) => [p.userId, p.attempts]).sort()).toEqual([['100', 0], ['99', 0]]);
  });

  it(`visits at most ${MAX_CHECKS}; the rest carry over, longest held first`, async () => {
    const total = 200;
    await t.hold(total, total - MAX_CHECKS - 3);
    expect(await t.pending()).toHaveLength(MAX_CHECKS + 3);
    expect(await t.checks.start(t.listsDone())).toBe(MAX_CHECKS);
    for (let i = 0; i < MAX_CHECKS; i++) {
      await t.runTimers();
      const head = t.scan()!.queue![0];
      await t.checks.onProfile(TAB, 200, profileBody({ id: head.userId, handle: head.handle, followedBy: true }));
    }
    expect(t.scan()).toBeUndefined();
    expect(t.notified).toEqual([]);
    expect(await t.pending()).toHaveLength(3);
    expect(t.opened).toHaveLength(MAX_CHECKS);
  });

  it(`after ${MAX_CHECK_ATTEMPTS} checks without an answer, reports as unconfirmed`, async () => {
    await t.hold(100, 99);
    for (let i = 0; i < MAX_CHECK_ATTEMPTS; i++) {
      await t.checks.start(t.listsDone());
      await t.runTimers();
      t.checks.pageReady(t.scan()!);
      await t.runTimers();
    }
    expect(t.notified.flat().map((e) => `${e.userId}:${e.reason}`)).toEqual(['100:unconfirmed']);
    expect(await t.pending()).toEqual([]);
  });

  it('held departures no check reached are reported after the time limit', async () => {
    await t.hold(100, 99);
    await t.checks.expire();
    expect(t.notified).toEqual([]);
    // expire() reads the injected clock: move it past the limit with a timer that far off.
    t.timers.push({ fn: () => t.checks.expire(), ms: PENDING_MAX_MS });
    await t.runTimers();
    expect(t.notified.flat().map((e) => `${e.userId}:${e.reason}`)).toEqual(['100:unconfirmed']);
  });
});
