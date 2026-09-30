import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PROFILE_FRESH_MS, Repo } from '../src/db/repo';
import { AppDB } from '../src/db/schema';
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

  it('second scan emits unfollower and new follower events', async () => {
    await scan('followers', mkUsers(1, 10));
    const r = await scan('followers', [...mkUsers(1, 8), ...mkUsers(11, 11)]);
    const types = r.committed!.events.map((e) => `${e.type}:${e.userId}`).sort();
    expect(types).toEqual(['LOST_FOLLOWER:10', 'LOST_FOLLOWER:9', 'NEW_FOLLOWER:11']);
    expect((await repo.recentEvents(OWNER)).length).toBe(3);
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
    await scan('following', mkUsers(1, 3)); // user 4 vanished from following
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
    expect(await repo.listMembers(OWNER, 'followers')).toHaveLength(199);
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
    await scan('following', mkUsers(1, 3)); // ...and vanished from following too
    const lost = (await repo.allEvents(OWNER)).find((e) => e.type === 'LOST_FOLLOWER')!;
    expect(lost.reason).toBe('likely_gone');
  });

  it('an observed unfollow is labelled by_me and does not mark their unfollow as likely_gone', async () => {
    await scan('followers', mkUsers(1, 4));
    await scan('following', mkUsers(1, 4));
    await repo.recordMyUnfollow(OWNER, '4', clock);
    const f = await scan('following', mkUsers(1, 3));
    expect(f.committed!.events).toMatchObject([{ type: 'UNFOLLOWED_BY_ME', userId: '4', reason: 'by_me' }]);
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
