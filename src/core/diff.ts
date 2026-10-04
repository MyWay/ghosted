import type { DiffEvent, ListKind, MemberRow, UserRecord } from './types';

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
}

export interface DiffResult {
  events: DiffEvent[];
  members: MemberRow[];
  /** Members missing from this scan, whether reported now or held for the next one. */
  removed: number;
}

export function diffScan(input: DiffInput): DiffResult {
  const { kind, prev, next, knownHandles, isBaseline, goneHint, myUnfollows, unavailable, confirmNow } = input;
  const events: DiffEvent[] = [];
  const prevById = new Map(prev.map((m) => [m.userId, m]));
  const nextById = new Map(next.map((u) => [u.id, u]));
  const kept: MemberRow[] = [];

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
      events.push({
        type: 'LOST_FOLLOWER',
        userId: m.userId,
        handle: m.handle,
        reason: goneHint?.has(m.userId) ? 'likely_gone' : 'unfollowed',
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
  return { events, members: [...members, ...kept], removed };
}
