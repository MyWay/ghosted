import type { DiffEvent, ListKind, MemberRow, UserRecord } from './types';

/** A follower a profile check showed still follows you is not checked again before this. */
export const RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

export interface DiffInput {
  kind: ListKind;
  prev: MemberRow[];
  next: UserRecord[];
  /** Handle stored for each known user id, across both lists (for RENAME). */
  knownHandles: Map<string, string>;
  /** First committed scan for this list: sets membership, emits no membership events. */
  isBaseline: boolean;
  /** Ids that vanished from the other list recently: probably suspended / deactivated. */
  goneHint?: Set<string>;
  /** Ids the owner was seen unfollowing on x.com recently. */
  myUnfollows?: Set<string>;
  /** Ids X listed as unavailable in this scan: still on the list, so never a departure. */
  unavailable?: Set<string>;
  /** Report every missing member now instead of waiting for a second miss (an accepted review). */
  confirmNow?: boolean;
  /**
   * Followers: hold confirmed departures in `toVerify` for a profile check instead of reporting
   * them, because X's Followers list leaves some followers out on every load.
   */
  verify?: boolean;
  /** Followers: the list came up shorter than X's count (or the count is unknown). */
  short?: boolean;
  /** Followers already held for a profile check: a check without profile visits leaves them held. */
  held?: Set<string>;
  now?: number;
}

export interface DiffResult {
  events: DiffEvent[];
  members: MemberRow[];
  /** Members missing from this scan, whether reported now or held for the next one. */
  removed: number;
  /** Followers missing twice, kept as members until a profile check says whether they left. */
  toVerify: MemberRow[];
}

export function diffScan(input: DiffInput): DiffResult {
  const { kind, prev, next, knownHandles, isBaseline, goneHint, myUnfollows, unavailable, confirmNow, verify, short, held, now = 0 } = input;
  const events: DiffEvent[] = [];
  const prevById = new Map(prev.map((m) => [m.userId, m]));
  const nextById = new Map(next.map((u) => [u.id, u]));
  const kept: MemberRow[] = [];
  const toVerify: MemberRow[] = [];

  for (const u of next) {
    const known = knownHandles.get(u.id);
    if (known && known.toLowerCase() !== u.handle.toLowerCase()) {
      events.push({ type: 'RENAME', userId: u.id, handle: u.handle, previousHandle: known });
    }
  }

  let removed = 0;
  for (const m of prev) {
    if (nextById.has(m.userId)) continue;
    if (unavailable?.has(m.userId)) {
      const { missing: _, ...row } = m;
      kept.push(row);
      continue;
    }
    removed++;
    if (isBaseline) continue;
    const byMe = kind === 'following' && !!myUnfollows?.has(m.userId);
    // X's lists sometimes skip people: hold a first miss until the next scan confirms it.
    if (!m.missing && !byMe && !confirmNow) {
      kept.push({ ...m, missing: true });
      continue;
    }
    if (kind === 'followers') {
      const gone = goneHint?.has(m.userId);
      if (!gone && !confirmNow) {
        // Their profile said they still follow you: X hides them from the list, not a departure.
        if (m.checkedAt && now - m.checkedAt < RECHECK_MS) {
          kept.push({ ...m, missing: true });
          continue;
        }
        if (verify || held?.has(m.userId)) {
          const row = { ...m, missing: true };
          kept.push(row);
          toVerify.push(row);
          continue;
        }
      }
      events.push({
        type: 'LOST_FOLLOWER',
        userId: m.userId,
        handle: m.handle,
        reason: gone ? 'likely_gone' : short ? 'unconfirmed' : 'unfollowed',
      });
    } else {
      events.push({ type: 'UNFOLLOWED_BY_ME', userId: m.userId, handle: m.handle, reason: byMe ? 'by_me' : 'unknown' });
    }
  }

  if (!isBaseline) {
    for (const u of next) {
      const before = prevById.get(u.id);
      if (!before) {
        events.push({ type: kind === 'followers' ? 'NEW_FOLLOWER' : 'NEW_FOLLOWING', userId: u.id, handle: u.handle });
        continue;
      }
      if (kind === 'following' && before.followsYou !== undefined && u.followsYou !== undefined) {
        if (before.followsYou && !u.followsYou) events.push({ type: 'LOST_MUTUAL', userId: u.id, handle: u.handle });
        else if (!before.followsYou && u.followsYou) events.push({ type: 'NEW_MUTUAL', userId: u.id, handle: u.handle });
      }
    }
  }

  const members: MemberRow[] = next.map((u) => ({
    userId: u.id,
    handle: u.handle,
    ...(kind === 'following' && u.followsYou !== undefined ? { followsYou: u.followsYou } : {}),
  }));
  return { events, members: [...members, ...kept], removed, toVerify };
}
