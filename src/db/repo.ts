import { applyPage, evaluate, isStale, needsReview, DEFAULT_THRESHOLD, type SessionState } from '../core/session';
import { diffScan } from '../core/diff';
import type { CheckOutcome } from '../core/autoscan';
import type { DiffEvent, ListKind, ParsedPage, UserRecord } from '../core/types';
import Dexie from 'dexie';
import { AppDB, LEGACY_DB_NAME, type EventRow, type MembershipRow, type ScanRow, type UserRow } from './schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const GONE_WINDOW_MS = 3 * DAY_MS;
const MY_UNFOLLOW_WINDOW_MS = 30 * DAY_MS;
/** Profile counts older than this are not trusted as the expected list size. */
export const PROFILE_FRESH_MS = 60 * 60 * 1000;
const KEEP_DEBUG_SESSIONS = 3;
/** A departure still unchecked this long after it was first held is reported without a check. */
export const PENDING_MAX_MS = 3 * DAY_MS;
/** Profile checks that got no answer before the departure is reported without one. */
export const MAX_CHECK_ATTEMPTS = 2;

/** A follower missing from two scans, kept as a member until a profile check says whether they left. */
export interface PendingDeparture {
  userId: string;
  handle: string;
  scanId: number;
  /** When first held; kept while later scans keep missing them. */
  at: number;
  /** The latest scan's list was shorter than X's count: X may be hiding them. */
  short: boolean;
  /** Profile checks that got no answer. */
  attempts: number;
}

export interface IngestInput {
  ownerId: string;
  kind: ListKind;
  requestCursor?: string;
  page: ParsedPage;
  now: number;
  /** Hold confirmed follower departures for a profile check (an assisted check can visit profiles). */
  verify?: boolean;
}

export interface CommitResult {
  scanId: number;
  baseline: boolean;
  events: EventRow[];
  /** Departures held for a profile check. */
  toVerify: number;
}

export interface IngestResult {
  scanId: number;
  status: ScanRow['status'];
  reason?: string;
  collected: number;
  committed?: CommitResult;
}

export class Repo {
  constructor(readonly db: AppDB = new AppDB()) {}

  // ---- settings -------------------------------------------------------

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db.settings.get(key);
    return row ? (row.value as T) : fallback;
  }
  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }

  async setProfileCounts(ownerId: string, followersCount?: number, followingCount?: number, now = Date.now()) {
    await this.setSetting(`profile:${ownerId}`, { followersCount, followingCount, at: now });
  }
  /**
   * Expected list size from the owner's profile, only if captured recently. A stale count would
   * be higher than reality after an unfollow wave and wrongly fail the completeness check.
   */
  async expectedCount(ownerId: string, kind: ListKind, now = Date.now()): Promise<number | undefined> {
    const p = await this.getSetting<{ followersCount?: number; followingCount?: number; at?: number } | null>(
      `profile:${ownerId}`,
      null,
    );
    if (!p?.at || now - p.at > PROFILE_FRESH_MS) return undefined;
    return kind === 'followers' ? p.followersCount : p.followingCount;
  }

  /** Remember that the owner unfollowed `userId` on x.com (seen via the page's own request). */
  async recordMyUnfollow(ownerId: string, userId: string, now: number): Promise<void> {
    const key = `myUnfollows:${ownerId}`;
    const map = await this.getSetting<Record<string, number>>(key, {});
    const pruned = Object.fromEntries(Object.entries(map).filter(([, at]) => now - at < MY_UNFOLLOW_WINDOW_MS));
    await this.setSetting(key, { ...pruned, [userId]: now });
  }

  private async myUnfollows(ownerId: string, now: number): Promise<Set<string>> {
    const map = await this.getSetting<Record<string, number>>(`myUnfollows:${ownerId}`, {});
    return new Set(Object.entries(map).filter(([, at]) => now - at < MY_UNFOLLOW_WINDOW_MS).map(([id]) => id));
  }

  // ---- ingest ---------------------------------------------------------

  /** Store one captured page, advance the session, and commit / finalize when it ends. */
  async ingestPage(input: IngestInput): Promise<IngestResult> {
    const { ownerId, kind, page, now } = input;
    const expected = await this.expectedCount(ownerId, kind, now);
    const threshold = await this.getSetting('threshold', DEFAULT_THRESHOLD);

    const result = await this.db.transaction('rw', [this.db.scans, this.db.scanItems, this.db.users], async () => {
      let scan = await this.currentScan(ownerId, kind);
      // A request without a cursor starts a new session: the old one can no longer complete.
      if (scan && input.requestCursor === undefined) {
        await this.finalizeScan(scan, 'abandoned', 'superseded by a new scan', now);
        scan = undefined;
      }
      let scanId = scan?.scanId;
      if (scanId === undefined) {
        scanId = await this.db.scans.add({
          ownerId,
          kind,
          startedAt: now,
          status: 'collecting',
          state: null as unknown as SessionState, // replaced below, before the transaction ends
          expected,
          collected: 0,
          source: 'graphql',
        });
      }
      await this.db.scanItems.bulkPut(page.users.map((user) => ({ scanId: scanId!, userId: user.id, user })));
      const collectedTotal = await this.db.scanItems.where('scanId').equals(scanId).count();
      const state = applyPage(scan?.state ?? null, {
        ownerId,
        kind,
        requestCursor: input.requestCursor,
        page,
        collectedTotal,
        now,
      });
      await this.db.scans.update(scanId, { state, collected: collectedTotal, expected });
      return { scanId, state, collectedTotal };
    });

    const verdict = evaluate(result.state, expected, threshold);
    const base = { scanId: result.scanId, collected: result.collectedTotal };
    if (verdict.status === 'collecting') return { ...base, status: 'collecting' };
    if (verdict.status === 'invalid') {
      const scan = (await this.db.scans.get(result.scanId))!;
      await this.finalizeScan(scan, 'invalid', verdict.reason, now);
      return { ...base, status: 'invalid', reason: verdict.reason };
    }
    const committed = await this.commitScan(result.scanId, { now, verify: input.verify });
    const finalScan = (await this.db.scans.get(result.scanId))!;
    return { ...base, status: finalScan.status, committed: committed ?? undefined };
  }

  private currentScan(ownerId: string, kind: ListKind) {
    return this.db.scans
      .where('[ownerId+kind]')
      .equals([ownerId, kind])
      .filter((s) => s.status === 'collecting')
      .last();
  }

  /** Abandoned / invalid scans keep metadata (avatars, counts) but never touch membership or handles. */
  private async finalizeScan(scan: ScanRow, status: 'abandoned' | 'invalid', reason: string, now: number) {
    const items = await this.db.scanItems.where('scanId').equals(scan.scanId!).toArray();
    await this.upsertUsers(scan.ownerId, items.map((i) => i.user), now, { keepHandle: true });
    await this.db.scans.update(scan.scanId!, { status, reason, endedAt: now });
    await this.purgeDebugItems(scan.ownerId, scan.kind);
  }

  /** Mark the collecting scan invalid, e.g. after an unparseable response. */
  async failCurrentScan(ownerId: string, kind: ListKind, reason: string, now: number): Promise<void> {
    const scan = await this.currentScan(ownerId, kind);
    if (scan) await this.finalizeScan(scan, 'invalid', reason, now);
  }

  async abandonStale(now: number): Promise<number> {
    const collecting = await this.db.scans.where('status').equals('collecting').toArray();
    let n = 0;
    for (const s of collecting) {
      if (isStale(s.state, now)) {
        await this.finalizeScan(s, 'abandoned', 'idle timeout', now);
        n++;
      }
    }
    return n;
  }

  private async purgeDebugItems(ownerId: string, kind: ListKind) {
    const finished = await this.db.scans
      .where('[ownerId+kind]')
      .equals([ownerId, kind])
      .filter((s) => s.status === 'invalid' || s.status === 'abandoned' || s.status === 'rejected')
      .sortBy('startedAt');
    for (const s of finished.slice(0, Math.max(0, finished.length - KEEP_DEBUG_SESSIONS))) {
      await this.db.scanItems.where('scanId').equals(s.scanId!).delete();
    }
  }

  // ---- commit ---------------------------------------------------------

  /**
   * Diff a complete scan against current membership and apply it. Idempotent: a committed scan
   * returns null. A suspicious number of removals parks the scan as `needs_review`.
   */
  async commitScan(scanId: number, opts: { now: number; force?: boolean; verify?: boolean }): Promise<CommitResult | null> {
    const { now, force = false, verify = false } = opts;
    return this.db.transaction('rw', this.db.tables, async () => {
      const scan = await this.db.scans.get(scanId);
      if (!scan || scan.status === 'committed' || scan.status === 'rejected') return null;
      const { ownerId, kind } = scan;

      const items = await this.db.scanItems.where('scanId').equals(scanId).toArray();
      const next = items.map((i) => i.user);
      const prev = await this.db.membership.where('[ownerId+kind]').equals([ownerId, kind]).toArray();
      const previousCommits = await this.db.scans
        .where('[ownerId+kind]')
        .equals([ownerId, kind])
        .filter((s) => s.status === 'committed')
        .count();
      const baseline = previousCommits === 0;

      const users = await this.db.users.where('ownerId').equals(ownerId).toArray();
      const knownHandles = new Map(users.map((u) => [u.id, u.handle]));
      // Left your following without you unfollowing them on x.com: probably suspended / deleted.
      const recentGone = await this.db.events
        .where('[ownerId+type]')
        .equals([ownerId, 'UNFOLLOWED_BY_ME'])
        .filter((e) => now - e.at < GONE_WINDOW_MS && e.reason !== 'by_me')
        .toArray();
      const goneHint = new Set(recentGone.map((e) => e.userId));
      const myUnfollows = await this.myUnfollows(ownerId, now);

      const unavailable = new Set(scan.state.unavailableIds ?? []);
      const short = scan.expected === undefined || scan.collected + (scan.state.unavailable ?? 0) < scan.expected;
      const pending = kind === 'followers' ? await this.pendingDepartures(ownerId) : [];
      const diff = diffScan({
        kind,
        prev,
        next,
        knownHandles,
        isBaseline: baseline,
        goneHint,
        myUnfollows,
        unavailable,
        confirmNow: force,
        verify,
        short,
        now,
        held: new Set(pending.map((p) => p.userId)),
      });

      // Without a fresh profile count the scan's completeness is unverified: be stricter.
      const strict = scan.expected === undefined;
      if (!baseline && !force && needsReview(prev.length, diff.removed, strict)) {
        await this.supersedeHeld(ownerId, kind, scan.startedAt, now);
        await this.db.scans.update(scanId, { status: 'needs_review', endedAt: now, pendingRemoved: diff.removed });
        return null;
      }

      await this.upsertUsers(ownerId, next, now, { keepHandle: false });
      await this.db.membership.where('[ownerId+kind]').equals([ownerId, kind]).delete();
      const rows: MembershipRow[] = diff.members.map((m) => ({ ownerId, kind, ...m }));
      await this.db.membership.bulkPut(rows);

      const eventRows: EventRow[] = diff.events.map((e: DiffEvent) => ({ ownerId, scanId, at: now, ...e }));
      const ids = await this.db.events.bulkAdd(eventRows, { allKeys: true });
      eventRows.forEach((e, i) => (e.id = ids[i] as number));

      if (kind === 'following') await this.relabelGoneFollowers(ownerId, diff.events, now);
      if (kind === 'followers') {
        // Still held, or back on the list (dropped). A re-held departure keeps its age and attempts.
        const missing = new Set(diff.members.filter((m) => m.missing).map((m) => m.userId));
        const kept = pending.filter((p) => missing.has(p.userId));
        const known = new Map(kept.map((p) => [p.userId, p]));
        const merged = kept.map((p) => ({ ...p, short }));
        for (const m of diff.toVerify) {
          if (!known.has(m.userId)) merged.push({ userId: m.userId, handle: m.handle, scanId, at: now, short, attempts: 0 });
        }
        await this.setSetting(`pendingDepartures:${ownerId}`, merged);
      }

      await this.db.scans.update(scanId, { status: 'committed', endedAt: now, reason: undefined });
      await this.db.scanItems.where('scanId').equals(scanId).delete();
      await this.supersedeHeld(ownerId, kind, scan.startedAt, now);
      return { scanId, baseline, events: eventRows, toVerify: diff.toVerify.length };
    });
  }

  // ---- profile checks -------------------------------------------------

  /** Held departures, longest held first: the order the profile checks visit them. */
  async pendingDepartures(ownerId: string): Promise<PendingDeparture[]> {
    const list = await this.getSetting<PendingDeparture[]>(`pendingDepartures:${ownerId}`, []);
    return list.map((p) => ({ ...p, attempts: p.attempts ?? 0 })).sort((a, b) => a.at - b.at);
  }

  /**
   * Apply a profile check of a held departure. Still follows: they stay a member X hides from the
   * list. Not following: an unfollow is recorded. No answer: they stay held for the next check,
   * unless that was the last attempt or they have waited too long; then the departure is recorded
   * without a check, as `unconfirmed` when the list was short. Returns the recorded event, or null.
   */
  async resolveDeparture(ownerId: string, userId: string, outcome: CheckOutcome, now: number): Promise<EventRow | null> {
    return this.db.transaction('rw', [this.db.settings, this.db.membership, this.db.events], async () => {
      const pending = await this.pendingDepartures(ownerId);
      const p = pending.find((d) => d.userId === userId);
      if (!p) return null;
      const rest = pending.filter((d) => d !== p);
      const key: [string, string, string] = [ownerId, 'followers', userId];
      const row = await this.db.membership.get(key);
      // Back in a newer scan: nothing to report.
      if (!row?.missing) {
        await this.setSetting(`pendingDepartures:${ownerId}`, rest);
        return null;
      }
      const attempts = outcome === 'unknown' ? p.attempts + 1 : p.attempts;
      if (outcome === 'unknown' && attempts < MAX_CHECK_ATTEMPTS && now - p.at < PENDING_MAX_MS) {
        await this.setSetting(`pendingDepartures:${ownerId}`, [...rest, { ...p, attempts }]);
        return null;
      }
      await this.setSetting(`pendingDepartures:${ownerId}`, rest);
      if (outcome === 'follows') {
        await this.db.membership.update(key, { checkedAt: now });
        return null;
      }
      await this.db.membership.delete(key);
      const reason = outcome === 'unknown' && p.short ? 'unconfirmed' : 'unfollowed';
      const event: EventRow = { ownerId, scanId: p.scanId, at: now, type: 'LOST_FOLLOWER', userId, handle: row.handle, reason };
      event.id = (await this.db.events.add(event)) as number;
      return event;
    });
  }

  /** Report held departures still unchecked after PENDING_MAX_MS (no assisted check ran in time). */
  async expirePending(ownerId: string, now: number): Promise<EventRow[]> {
    const events: EventRow[] = [];
    for (const p of await this.pendingDepartures(ownerId)) {
      if (now - p.at < PENDING_MAX_MS) continue;
      const e = await this.resolveDeparture(ownerId, p.userId, 'unknown', now);
      if (e) events.push(e);
    }
    return events;
  }

  /**
   * Followers scanned before following: a follower who left and has now also vanished from your
   * following (without you unfollowing them) was most likely suspended / deleted.
   */
  private async relabelGoneFollowers(ownerId: string, events: DiffEvent[], now: number) {
    const vanished = new Set(events.filter((e) => e.type === 'UNFOLLOWED_BY_ME' && e.reason !== 'by_me').map((e) => e.userId));
    if (!vanished.size) return;
    await this.db.events
      .where('[ownerId+type]')
      .equals([ownerId, 'LOST_FOLLOWER'])
      .filter((e) => vanished.has(e.userId) && (e.reason === 'unfollowed' || e.reason === 'unconfirmed') && now - e.at < GONE_WINDOW_MS)
      .modify({ reason: 'likely_gone' });
  }

  /** Held scans older than `startedAt` are outdated: applying them would roll membership back. */
  private async supersedeHeld(ownerId: string, kind: ListKind, startedAt: number, now: number) {
    const held = await this.db.scans
      .where('[ownerId+kind]')
      .equals([ownerId, kind])
      .filter((s) => s.status === 'needs_review' && s.startedAt <= startedAt)
      .toArray();
    for (const s of held) {
      await this.db.scans.update(s.scanId!, { status: 'rejected', reason: 'superseded by a newer scan', endedAt: now });
      await this.db.scanItems.where('scanId').equals(s.scanId!).delete();
    }
  }

  /** Resolve a `needs_review` scan: accept applies it, reject discards it. */
  async resolveReview(scanId: number, accept: boolean, now = Date.now()): Promise<CommitResult | null> {
    const scan = await this.db.scans.get(scanId);
    if (!scan || scan.status !== 'needs_review') return null;
    const newer = await this.lastCommit(scan.ownerId, scan.kind);
    if (newer && newer.startedAt > scan.startedAt) {
      await this.supersedeHeld(scan.ownerId, scan.kind, scan.startedAt, now);
      return null;
    }
    if (accept) return this.commitScan(scanId, { now, force: true });
    await this.db.scans.update(scanId, { status: 'rejected', endedAt: now });
    await this.db.scanItems.where('scanId').equals(scanId).delete();
    return null;
  }

  private async upsertUsers(ownerId: string, records: UserRecord[], now: number, opts: { keepHandle: boolean }) {
    const existing = await this.db.users.bulkGet(records.map((r) => [ownerId, r.id] as [string, string]));
    const rows: UserRow[] = records.map((r, i) => {
      const prev = existing[i];
      const handle = opts.keepHandle && prev ? prev.handle : r.handle;
      const history = prev?.handleHistory ?? [];
      return {
        ownerId,
        id: r.id,
        handle,
        name: r.name || prev?.name || '',
        avatarUrl: r.avatarUrl ?? prev?.avatarUrl,
        followersCount: r.followersCount ?? prev?.followersCount,
        followingCount: r.followingCount ?? prev?.followingCount,
        isProtected: r.isProtected ?? prev?.isProtected,
        isVerified: r.isVerified ?? prev?.isVerified,
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: now,
        handleHistory: prev && prev.handle.toLowerCase() !== handle.toLowerCase() ? [...history, prev.handle] : history,
      };
    });
    await this.db.users.bulkPut(rows);
  }

  // ---- queries --------------------------------------------------------

  async lastCommit(ownerId: string, kind: ListKind): Promise<ScanRow | undefined> {
    return this.db.scans
      .where('[ownerId+kind]')
      .equals([ownerId, kind])
      .filter((s) => s.status === 'committed')
      .last();
  }

  async listMembers(ownerId: string, kind: ListKind): Promise<Array<MembershipRow & { user?: UserRow }>> {
    const rows = await this.db.membership.where('[ownerId+kind]').equals([ownerId, kind]).toArray();
    const users = await this.db.users.where('ownerId').equals(ownerId).toArray();
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, user: byId.get(r.userId) }));
  }

  async recentEvents(ownerId: string, limit = 50, sinceId = 0): Promise<EventRow[]> {
    return this.db.events
      .where('[ownerId+at]')
      .between([ownerId, 0], [ownerId, Infinity])
      .reverse()
      .filter((e) => (e.id ?? 0) > sinceId)
      .limit(limit)
      .toArray();
  }

  /** Highest event id for the owner (ids only grow, so this is the newest event recorded). */
  async maxEventId(ownerId: string): Promise<number> {
    const last = await this.db.events.orderBy(':id').reverse().filter((e) => e.ownerId === ownerId).first();
    return last?.id ?? 0;
  }

  async allEvents(ownerId: string): Promise<EventRow[]> {
    return this.db.events.where('[ownerId+at]').between([ownerId, 0], [ownerId, Infinity]).reverse().toArray();
  }

  async listScans(ownerId: string, limit = 50): Promise<ScanRow[]> {
    return (await this.db.scans.orderBy('startedAt').reverse().filter((s) => s.ownerId === ownerId).limit(limit).toArray());
  }

  // ---- export / import / wipe ----------------------------------------

  async exportAll(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const t of this.db.tables) out[t.name] = await t.toArray();
    return out;
  }

  async importAll(data: Record<string, unknown[]>): Promise<void> {
    await this.db.transaction('rw', this.db.tables, async () => {
      for (const t of this.db.tables) {
        if (!Array.isArray(data[t.name])) continue;
        await t.clear();
        await t.bulkPut(data[t.name] as never[]);
      }
    });
  }

  async wipe(): Promise<void> {
    await this.db.transaction('rw', this.db.tables, async () => {
      for (const t of this.db.tables) await t.clear();
    });
  }
}

/**
 * One-time copy from the pre-rename database. Runs only when the old database exists and the new
 * one is still empty, then deletes the old one.
 */
export async function migrateLegacyDb(target: AppDB, legacyName = LEGACY_DB_NAME): Promise<boolean> {
  if (!(await Dexie.exists(legacyName))) return false;
  if ((await target.settings.count()) + (await target.scans.count()) > 0) return false;
  const legacy = new AppDB(legacyName);
  try {
    const dump = await new Repo(legacy).exportAll();
    await new Repo(target).importAll(dump);
  } finally {
    legacy.close();
  }
  await Dexie.delete(legacyName);
  return true;
}
