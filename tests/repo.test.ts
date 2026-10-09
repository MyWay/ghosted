import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PENDING_MAX_MS, PROFILE_FRESH_MS, Repo } from '../src/db/repo';
import { AppDB } from '../src/db/schema';
import { DEFAULT_PREFS, summarize } from '../src/notify/format';
import type { ListKind, ParsedPage } from '../src/core/types';
import { mkUsers, type FakeUser } from './helpers';

const OWNER = '999';
let repo: Repo;
let clock = 1_000_000;
let n = 0;

beforeEach(() => {
  repo = new Repo(new AppDB(`test-${n++}`));
  clock = 1_000_000;
});

const toPage = (users: FakeUser[], bottomCursor?: string): ParsedPage => ({
  users: users.map((u) => ({ id: u.id, handle: u.handle, name: u.handle, followsYou: u.followedBy })),
  bottomCursor,
  warnings: 0,
  unavailable: 0,
});

/** Feed a whole list as a single top page followed by an empty terminal page. */
async function scan(kind: ListKind, users: FakeUser[], opts: { counts?: boolean } = {}) {
  clock += 60_000;
  if (opts.counts !== false) {
    await repo.setProfileCounts(OWNER, kind === 'followers' ? users.length : undefined, kind === 'following' ? users.length : undefined, clock);
  } else {
    await repo.db.settings.delete(`profile:${OWNER}`);
  }
  const first = await repo.ingestPage({ ownerId: OWNER, kind, page: toPage(users, 'end|1'), now: clock });
  if (first.status !== 'collecting') return first;
  return repo.ingestPage({ ownerId: OWNER, kind, requestCursor: 'end|1', page: toPage([]), now: clock });
}

describe('repo scans', () => {
  it('first scan is a baseline with no events', async () => {
    const r = await scan('followers', mkUsers(1, 10));
    expect(r.status).toBe('committed');
    expect(r.committed?.baseline).toBe(true);
    expect(r.committed?.events).toEqual([]);
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(10);
  });

  it('reports an unfollower once a second scan also misses them', async () => {
    await scan('followers', mkUsers(1, 10));
    const first = await scan('followers', [...mkUsers(1, 8), ...mkUsers(11, 11)]);
    expect(first.committed!.events.map((e) => `${e.type}:${e.userId}`)).toEqual(['NEW_FOLLOWER:11']);
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(11);
    const r = await scan('followers', [...mkUsers(1, 8), ...mkUsers(11, 11)]);
    const types = r.committed!.events.map((e) => `${e.type}:${e.userId}`).sort();
    expect(types).toEqual(['LOST_FOLLOWER:10', 'LOST_FOLLOWER:9']);
    expect((await repo.recentEvents(OWNER)).length).toBe(3);
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(9);
  });

  it('someone X skipped once is not reported when they are back next scan', async () => {
    await scan('followers', mkUsers(1, 10));
    await scan('followers', mkUsers(1, 9));
    const r = await scan('followers', mkUsers(1, 10));
    expect(r.committed!.events).toEqual([]);
    expect((await repo.listMembers(OWNER, 'followers')).filter((m) => m.missing)).toEqual([]);
  });

  it('strangers after the baseline are new followers at most: no unfollow is claimed or notified', async () => {
    await scan('followers', mkUsers(1, 3));
    // user 1 stays; X skipped 2 and 3 (held, not departures); 10 and 11 were never in the circle.
    const r = await scan('followers', [mkUsers(1, 1)[0], ...mkUsers(10, 11)]);
    expect(r.committed!.events.map((e) => `${e.type}:${e.userId}`).sort()).toEqual(['NEW_FOLLOWER:10', 'NEW_FOLLOWER:11']);
    // None of that is worth a notification with the default prefs.
    expect(summarize(r.committed!.events, DEFAULT_PREFS)).toBeNull();
  });

  it('committing a scan twice records nothing the second time', async () => {
    await scan('followers', mkUsers(1, 10));
    await scan('followers', mkUsers(1, 9)); // first miss of 10: held
    const r = await scan('followers', mkUsers(1, 9)); // confirmed: LOST_FOLLOWER:10
    expect(r.committed!.events.map((e) => `${e.type}:${e.userId}`)).toEqual(['LOST_FOLLOWER:10']);
    const before = (await repo.allEvents(OWNER)).length;
    expect(await repo.commitScan(r.committed!.scanId, { now: clock })).toBeNull();
    expect((await repo.allEvents(OWNER)).length).toBe(before);
  });

  it('an unavailable entry is not a departure', async () => {
    await scan('followers', mkUsers(1, 3));
    for (let i = 0; i < 2; i++) {
      clock += 60_000;
      await repo.setProfileCounts(OWNER, 3, undefined, clock);
      const page = { ...toPage(mkUsers(1, 2), 'end|1'), unavailable: 1, unavailableIds: ['3'] };
      await repo.ingestPage({ ownerId: OWNER, kind: 'followers', page, now: clock });
      const r = await repo.ingestPage({ ownerId: OWNER, kind: 'followers', requestCursor: 'end|1', page: toPage([]), now: clock });
      expect(r.committed!.events).toEqual([]);
    }
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(3);
  });

  it('records a rename instead of an unfollow', async () => {
    await scan('followers', mkUsers(1, 3));
    const renamed = mkUsers(1, 3);
    renamed[0].handle = 'brandnew';
    const r = await scan('followers', renamed);
    expect(r.committed!.events.map((e) => e.type)).toEqual(['RENAME']);
    const u = await repo.db.users.get([OWNER, '1']);
    expect(u?.handle).toBe('brandnew');
    expect(u?.handleHistory).toEqual(['user1']);
  });

  it('detects lost mutuals from a following-only scan', async () => {
    await scan('following', mkUsers(1, 5, { followedBy: true }));
    const next = mkUsers(1, 5, { followedBy: true });
    next[2].followedBy = false;
    const r = await scan('following', next);
    expect(r.committed!.events.map((e) => `${e.type}:${e.userId}`)).toEqual(['LOST_MUTUAL:3']);
  });

  it('never diffs a partial scan and keeps membership untouched', async () => {
    await scan('followers', mkUsers(1, 10));
    clock += 1000;
    await repo.setProfileCounts(OWNER, 10, undefined, clock);
    const r = await repo.ingestPage({ ownerId: OWNER, kind: 'followers', page: toPage(mkUsers(1, 4)), now: clock });
    expect(r.status).toBe('invalid');
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(10);
    expect(await repo.recentEvents(OWNER)).toEqual([]);
  });

  it('holds suspicious mass removals for review and applies them on accept', async () => {
    await scan('followers', mkUsers(1, 200));
    const r = await scan('followers', mkUsers(1, 100));
    expect(r.status).toBe('needs_review');
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(200);
    const held = (await repo.listScans(OWNER)).find((s) => s.status === 'needs_review')!;
    const done = await repo.resolveReview(held.scanId!, true, clock + 1);
    expect(done!.events).toHaveLength(100);
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(100);
  });

  it('reject discards a held scan', async () => {
    await scan('followers', mkUsers(1, 200));
    await scan('followers', mkUsers(1, 100));
    const held = (await repo.listScans(OWNER)).find((s) => s.status === 'needs_review')!;
    await repo.resolveReview(held.scanId!, false);
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(200);
    expect((await repo.listScans(OWNER)).find((s) => s.scanId === held.scanId)?.status).toBe('rejected');
  });

  it('a new top-of-list request abandons the previous session', async () => {
    await repo.ingestPage({ ownerId: OWNER, kind: 'followers', page: toPage(mkUsers(1, 5), 'c1'), now: clock });
    await repo.ingestPage({ ownerId: OWNER, kind: 'followers', page: toPage(mkUsers(1, 5), 'c2'), now: clock + 1 });
    const scans = await repo.listScans(OWNER);
    expect(scans.map((s) => s.status).sort()).toEqual(['abandoned', 'collecting']);
  });

  it('abandons idle sessions without touching membership', async () => {
    await repo.ingestPage({ ownerId: OWNER, kind: 'followers', page: toPage(mkUsers(1, 5), 'c1'), now: clock });
    expect(await repo.abandonStale(clock + 11 * 60_000)).toBe(1);
    expect(await repo.listMembers(OWNER, 'followers')).toEqual([]);
    expect(await repo.db.users.count()).toBe(5);
  });

  it('flags a follower who also vanished from following as likely_gone', async () => {
    await scan('followers', mkUsers(1, 4));
    await scan('following', mkUsers(1, 4));
    await scan('following', mkUsers(1, 3)); // user 4 vanished from following...
    await scan('following', mkUsers(1, 3)); // ...confirmed
    await scan('followers', mkUsers(1, 3));
    const r = await scan('followers', mkUsers(1, 3));
    expect(r.committed!.events).toMatchObject([{ type: 'LOST_FOLLOWER', userId: '4', reason: 'likely_gone' }]);
  });

  it('export then import round-trips', async () => {
    await scan('followers', mkUsers(1, 3));
    const dump = await repo.exportAll();
    await repo.wipe();
    expect(await repo.db.users.count()).toBe(0);
    await repo.importAll(dump);
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(3);
  });

  it('ignores a stale profile count instead of rejecting a smaller list', async () => {
    await scan('followers', mkUsers(1, 100));
    await repo.setProfileCounts(OWNER, 100, undefined, clock);
    clock += PROFILE_FRESH_MS + 60_000;
    // 10 people unfollowed since the count was captured; with the stale count (100) it would look shorter than expected.
    const r1 = await repo.ingestPage({ ownerId: OWNER, kind: 'followers', page: toPage(mkUsers(1, 90), 'end|1'), now: clock });
    const r = await repo.ingestPage({ ownerId: OWNER, kind: 'followers', requestCursor: 'end|1', page: toPage([]), now: clock });
    expect(r1.status).toBe('collecting');
    expect(r.status).toBe('needs_review'); // strict: 10 > max(5, 1%) without a verified count
  });

  it('commits small removals without a count, holds larger ones', async () => {
    await scan('followers', mkUsers(1, 100));
    const small = await scan('followers', mkUsers(1, 96), { counts: false });
    expect(small.status).toBe('committed');
    const big = await scan('followers', mkUsers(1, 88), { counts: false });
    expect(big.status).toBe('needs_review');
    const verified = await scan('followers', mkUsers(1, 88));
    expect(verified.status).toBe('committed');
  });

  it('a newer committed scan supersedes a held one, which can no longer be applied', async () => {
    await scan('followers', mkUsers(1, 200));
    await scan('followers', mkUsers(1, 100)); // held
    const held = (await repo.listScans(OWNER)).find((s) => s.status === 'needs_review')!;
    await scan('followers', mkUsers(1, 199)); // newer, normal
    expect((await repo.db.scans.get(held.scanId!))?.status).toBe('rejected');
    expect(await repo.resolveReview(held.scanId!, true, clock + 1)).toBeNull();
    const members = await repo.listMembers(OWNER, 'followers');
    expect(members.filter((m) => !m.missing)).toHaveLength(199);
  });

  it('a new held scan supersedes an older held one', async () => {
    await scan('followers', mkUsers(1, 200));
    await scan('followers', mkUsers(1, 100));
    await scan('followers', mkUsers(1, 90));
    const statuses = (await repo.listScans(OWNER)).map((s) => s.status);
    expect(statuses.filter((s) => s === 'needs_review')).toHaveLength(1);
    expect(statuses).toContain('rejected');
  });

  it('relabels a lost follower as likely_gone when following is scanned afterwards', async () => {
    await scan('followers', mkUsers(1, 4));
    await scan('following', mkUsers(1, 4));
    await scan('followers', mkUsers(1, 3)); // 4 left followers first
    await scan('followers', mkUsers(1, 3));
    await scan('following', mkUsers(1, 3)); // ...and vanished from following too
    await scan('following', mkUsers(1, 3));
    const lost = (await repo.allEvents(OWNER)).find((e) => e.type === 'LOST_FOLLOWER')!;
    expect(lost.reason).toBe('likely_gone');
  });

  it('an observed unfollow is labelled by_me and does not mark their unfollow as likely_gone', async () => {
    await scan('followers', mkUsers(1, 4));
    await scan('following', mkUsers(1, 4));
    await repo.recordMyUnfollow(OWNER, '4', clock);
    const f = await scan('following', mkUsers(1, 3));
    expect(f.committed!.events).toMatchObject([{ type: 'UNFOLLOWED_BY_ME', userId: '4', reason: 'by_me' }]);
    await scan('followers', mkUsers(1, 3));
    const r = await scan('followers', mkUsers(1, 3));
    expect(r.committed!.events).toMatchObject([{ type: 'LOST_FOLLOWER', userId: '4', reason: 'unfollowed' }]);
  });
});

import { migrateLegacyDb } from '../src/db/repo';
import Dexie from 'dexie';

describe('legacy database migration', () => {
  it('copies the old database into an empty new one, then deletes the old one', async () => {
    const legacyName = `legacy-${n++}`;
    const old = new Repo(new AppDB(legacyName));
    await old.setSetting('ownerId', '42');
    await old.db.events.add({ ownerId: '42', scanId: 1, at: 1, type: 'LOST_FOLLOWER', userId: '7', handle: 'x' });
    old.db.close();
    expect(await migrateLegacyDb(repo.db, legacyName)).toBe(true);
    expect(await repo.getSetting('ownerId', null)).toBe('42');
    expect(await repo.db.events.count()).toBe(1);
    expect(await Dexie.exists(legacyName)).toBe(false);
    expect(await migrateLegacyDb(repo.db, legacyName)).toBe(false);
  });

  it('never overwrites a database that already has data', async () => {
    const legacyName = `legacy-${n++}`;
    const old = new Repo(new AppDB(legacyName));
    await old.setSetting('ownerId', 'old');
    old.db.close();
    await repo.setSetting('ownerId', 'new');
    expect(await migrateLegacyDb(repo.db, legacyName)).toBe(false);
    expect(await repo.getSetting('ownerId', null)).toBe('new');
  });
});

describe('maxEventId', () => {
  it('returns the highest id for the owner regardless of event time', async () => {
    await repo.db.events.bulkAdd([
      { ownerId: OWNER, scanId: 1, at: 500, type: 'NEW_FOLLOWER', userId: '1', handle: 'a' },
      { ownerId: OWNER, scanId: 1, at: 100, type: 'NEW_FOLLOWER', userId: '2', handle: 'b' },
      { ownerId: 'other', scanId: 1, at: 900, type: 'NEW_FOLLOWER', userId: '3', handle: 'c' },
    ]);
    expect(await repo.maxEventId(OWNER)).toBe(2);
    expect(await repo.maxEventId('nobody')).toBe(0);
  });
});

import { buildDiagnostics } from '../src/db/diagnostics';

describe('diagnostics', () => {
  it('summarises scans and counts without names, handles or ids', async () => {
    await scan('followers', mkUsers(1, 40));
    const info = await buildDiagnostics(repo, OWNER, { version: '9.9.9', userAgent: 'TestBrowser/1' }, clock + 5 * 60_000);
    expect(info.version).toBe('9.9.9');
    expect(info.saved).toEqual({ followers: 40, following: 0 });
    expect(info.latestScans[0]).toMatchObject({ kind: 'followers', status: 'committed', collected: 40, xCount: 40, unavailable: 0 });
    expect(info.profileCount).toMatchObject({ followers: 40 });
    const text = JSON.stringify(info);
    expect(text).not.toMatch(/user\d+/);
    expect(text).not.toContain(OWNER);
  });
  it('works before any account or scan exists', async () => {
    const info = await buildDiagnostics(repo, undefined, { version: '1.0.0', userAgent: 'x' });
    expect(info.latestScans).toEqual([]);
    expect(info.saved).toBeNull();
  });
});

describe('profile checks of departed followers', () => {
  /** A followers scan where X's count is `count` (default: the list size) and the check can visit profiles. */
  async function check(users: FakeUser[], count = users.length, verify = true) {
    clock += 60_000;
    await repo.setProfileCounts(OWNER, count, undefined, clock);
    const first = await repo.ingestPage({ ownerId: OWNER, kind: 'followers', page: toPage(users, 'end|1'), now: clock, verify });
    if (first.status !== 'collecting') return first;
    return repo.ingestPage({ ownerId: OWNER, kind: 'followers', requestCursor: 'end|1', page: toPage([]), now: clock, verify });
  }
  const member = async (id: string) => (await repo.listMembers(OWNER, 'followers')).find((m) => m.userId === id);

  it('a follower X hides from the list but whose profile says they follow you is never reported', async () => {
    await check(mkUsers(1, 10));
    await check(mkUsers(1, 9), 10);
    const r = await check(mkUsers(1, 9), 10);
    expect(r.committed).toMatchObject({ events: [], toVerify: 1 });
    expect((await repo.pendingDepartures(OWNER)).map((p) => p.userId)).toEqual(['10']);
    expect(await repo.resolveDeparture(OWNER, '10', 'follows', clock)).toBeNull();
    expect(await repo.pendingDepartures(OWNER)).toEqual([]);
    expect(await member('10')).toMatchObject({ missing: true, checkedAt: clock });
    // Still hidden on later checks: no event, no new profile visit.
    const later = await check(mkUsers(1, 9), 10);
    expect(later.committed).toMatchObject({ events: [], toVerify: 0 });
    expect(await repo.recentEvents(OWNER)).toEqual([]);
  });

  it('a profile that says they no longer follow you records an unfollow', async () => {
    await check(mkUsers(1, 10));
    await check(mkUsers(1, 9), 10);
    await check(mkUsers(1, 9), 10);
    const e = await repo.resolveDeparture(OWNER, '10', 'left', clock);
    expect(e).toMatchObject({ type: 'LOST_FOLLOWER', userId: '10', reason: 'unfollowed' });
    expect(await member('10')).toBeUndefined();
    expect(summarize([e!], DEFAULT_PREFS)!.lines).toEqual(['1 unfollowed you: @user10']);
  });

  it('no answer from the profile: unconfirmed when the list was short, unfollowed when it was full', async () => {
    await check(mkUsers(1, 10));
    await check(mkUsers(1, 9), 10);
    await check(mkUsers(1, 9), 10);
    const e = await repo.resolveDeparture(OWNER, '10', 'unknown', clock);
    expect(e?.reason).toBe('unconfirmed');
    expect(summarize([e!], DEFAULT_PREFS)!.lines).toEqual(['1 no longer in your followers list (X may be hiding them): @user10']);
    // A full list (X's count matches) but no answer: they did leave the list X says is complete.
    await check(mkUsers(1, 8), 8);
    await check(mkUsers(1, 8), 8);
    expect((await repo.resolveDeparture(OWNER, '9', 'unknown', clock))?.reason).toBe('unfollowed');
  });

  it('a manual check (no profile visits) reports a short list departure as unconfirmed', async () => {
    await check(mkUsers(1, 10), 10, false);
    await check(mkUsers(1, 9), 10, false);
    const r = await check(mkUsers(1, 9), 10, false);
    expect(r.committed!.events.map((e) => [e.userId, e.reason])).toEqual([['10', 'unconfirmed']]);
  });

  it('someone back in a newer scan before the check is not reported', async () => {
    await check(mkUsers(1, 10));
    await check(mkUsers(1, 9), 10);
    await check(mkUsers(1, 9), 10);
    await check(mkUsers(1, 10));
    expect(await repo.resolveDeparture(OWNER, '10', 'left', clock)).toBeNull();
    expect(await member('10')).toMatchObject({ userId: '10' });
  });

  it('a check that never ran is reported unchecked after a while', async () => {
    await check(mkUsers(1, 10));
    await check(mkUsers(1, 9), 10);
    await check(mkUsers(1, 9), 10);
    expect(await repo.expirePending(OWNER, clock + 60_000)).toEqual([]);
    const events = await repo.expirePending(OWNER, clock + PENDING_MAX_MS);
    expect(events.map((e) => [e.userId, e.reason])).toEqual([['10', 'unconfirmed']]);
    expect(await repo.pendingDepartures(OWNER)).toEqual([]);
  });
});
