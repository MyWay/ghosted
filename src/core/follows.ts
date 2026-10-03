import type { EventReason, EventType } from './types';

/** The event fields the follower-change logic needs. */
export interface FollowEvent {
  id?: number;
  at: number;
  type: EventType;
  userId: string;
  handle: string;
  reason?: EventReason;
}

export type FollowChange = 'gain' | 'loss';

/**
 * "Followed you back" (NEW_MUTUAL) is a gain and "stopped following you back" (LOST_MUTUAL) a loss:
 * someone you follow who starts or stops following you changes your follower count too.
 */
export function followChange(type: EventType): FollowChange | null {
  if (type === 'NEW_FOLLOWER' || type === 'NEW_MUTUAL') return 'gain';
  if (type === 'LOST_FOLLOWER' || type === 'LOST_MUTUAL') return 'loss';
  return null;
}

const chronological = <T extends FollowEvent>(events: T[]) =>
  [...events].sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));

/**
 * Follower changes that repeat the user's previous one. Both lists report the same flip (the
 * following scan as LOST_MUTUAL, the followers scan as LOST_FOLLOWER), possibly days apart. Two
 * losses in a row with no gain recorded between them are therefore one departure, not two.
 */
export function repeatedChanges<T extends FollowEvent>(events: T[]): Set<T> {
  const last = new Map<string, FollowChange>();
  const repeats = new Set<T>();
  for (const e of chronological(events)) {
    const change = followChange(e.type);
    if (!change) continue;
    if (last.get(e.userId) === change) repeats.add(e);
    else last.set(e.userId, change);
  }
  return repeats;
}

/** Follower changes with repeats removed, oldest first. */
export function distinctChanges<T extends FollowEvent>(events: T[]): T[] {
  const repeats = repeatedChanges(events);
  return chronological(events).filter((e) => followChange(e.type) && !repeats.has(e));
}

/** `events` minus follower changes that `history` (which includes them) shows to be repeats. */
export function withoutRepeats<T extends FollowEvent>(events: T[], history: FollowEvent[]): T[] {
  const ids = new Set([...repeatedChanges(history)].map((e) => e.id));
  return events.filter((e) => e.id === undefined || !ids.has(e.id));
}
