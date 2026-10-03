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

export interface Boomerang {
  userId: string;
  /** Handle from the newest event. */
  handle: string;
  /** Times they followed you and then left (suspensions excluded). */
  cycles: number;
  lastLeftAt: number;
  /** Their follower changes, oldest first. */
  history: Array<{ at: number; change: FollowChange }>;
}

export const MIN_CYCLES = 2;

/**
 * People who unfollowed you at least `minCycles` times, most cycles first. A departure labeled
 * "likely gone" (suspended / deleted) is not a choice to unfollow and does not count.
 */
export function findBoomerangs(events: FollowEvent[], minCycles = MIN_CYCLES): Boomerang[] {
  const byUser = new Map<string, Boomerang>();
  for (const e of distinctChanges(events)) {
    const change = followChange(e.type)!;
    let u = byUser.get(e.userId);
    if (!u) byUser.set(e.userId, (u = { userId: e.userId, handle: e.handle, cycles: 0, lastLeftAt: 0, history: [] }));
    u.handle = e.handle;
    u.history.push({ at: e.at, change });
    if (change === 'loss' && e.reason !== 'likely_gone') {
      u.cycles++;
      u.lastLeftAt = e.at;
    }
  }
  return [...byUser.values()]
    .filter((u) => u.cycles >= minCycles)
    .sort((a, b) => b.cycles - a.cycles || b.lastLeftAt - a.lastLeftAt);
}

export interface CycleBadge {
  tier: 'bronze' | 'silver' | 'gold';
  label: string;
  emoji: string;
}

export function cycleBadge(cycles: number): CycleBadge | null {
  if (cycles >= 5) return { tier: 'gold', label: 'Revolving door', emoji: '🥇' };
  if (cycles >= 3) return { tier: 'silver', label: 'Yo-yo', emoji: '🥈' };
  if (cycles >= MIN_CYCLES) return { tier: 'bronze', label: 'Flip-flopper', emoji: '🥉' };
  return null;
}

/** `events` minus follower changes that `history` (which includes them) shows to be repeats. */
export function withoutRepeats<T extends FollowEvent>(events: T[], history: FollowEvent[]): T[] {
  const ids = new Set([...repeatedChanges(history)].map((e) => e.id));
  return events.filter((e) => e.id === undefined || !ids.has(e.id));
}
