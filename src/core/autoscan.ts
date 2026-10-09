import type { ListKind } from './types';

/** A follower missing from two scans, whose profile the check visits before reporting them. */
export interface ToCheck {
  userId: string;
  handle: string;
}

/**
 * State of an assisted check. Each list is preceded by a visit to the owner's profile so X sends
 * a fresh follower/following count (UserByScreenName), which the completeness check needs. After
 * the lists, the check visits the profile of each follower who seems to have left: X's Followers
 * list leaves some followers out, and the profile shows whether they still follow you.
 */
export interface AutoScan {
  tabId: number;
  kinds: ListKind[];
  handle: string;
  startedAt: number;
  phase: 'profile' | 'list' | 'verify';
  /** Lists in the whole check (`kinds` shrinks as lists finish). Missing in state saved by older versions. */
  total?: number;
  /** Profiles still to visit in the verify phase, current first. */
  queue?: ToCheck[];
  /** Profiles in the whole verify phase, for "1 of 3". */
  queueTotal?: number;
  /** Departures recorded by the verify phase so far, alerted together at its end. */
  eventIds?: number[];
}

/** How long to wait on the profile page for the count before moving on anyway. */
export const PROFILE_WAIT_MS = 8000;
/** How long to wait on a follower's profile for X's answer before reporting them unchecked. */
export const CHECK_WAIT_MS = 12_000;
/** Most profiles one check visits; departures past this are reported unchecked. */
export const MAX_CHECKS = 15;

export const newAutoScan = (tabId: number, kinds: ListKind[], handle: string, now: number): AutoScan => ({
  tabId,
  kinds,
  handle,
  startedAt: now,
  phase: 'profile',
  total: kinds.length,
});

/** Which list of the check is current, 1-based: "1 of 2". */
export const stepOf = (s: AutoScan): { index: number; total: number } => {
  const total = Math.max(s.total ?? s.kinds.length, s.kinds.length);
  return { index: total - s.kinds.length + 1, total };
};

/** Page the tab should be on for the current phase. */
export function urlFor(s: AutoScan): string {
  if (s.phase === 'verify') return `https://x.com/${s.queue?.[0]?.handle ?? s.handle}`;
  return s.phase === 'profile' ? `https://x.com/${s.handle}` : `https://x.com/${s.handle}/${s.kinds[0]}`;
}

const norm = (path: string) => path.toLowerCase().replace(/\/+$/, '');

export type BridgeAnswer = {
  autoscroll: ListKind | null;
  waitForProfile: boolean;
  /** This page is a follower's profile the check is visiting. */
  checking?: { handle: string; index: number; total: number };
};

/** What a freshly loaded x.com page in `tabId` should do. */
export function answerBridgeReady(s: AutoScan | undefined, tabId: number | undefined, path: string): BridgeAnswer {
  const none = { autoscroll: null, waitForProfile: false };
  if (!s || tabId !== s.tabId) return none;
  const here = norm(path);
  if (s.phase === 'verify') {
    const head = s.queue?.[0];
    if (!head || here !== norm(`/${head.handle}`)) return none;
    const total = Math.max(s.queueTotal ?? 0, s.queue!.length);
    return { ...none, checking: { handle: head.handle, index: total - s.queue!.length + 1, total } };
  }
  if (s.phase === 'profile') return { autoscroll: null, waitForProfile: here === norm(`/${s.handle}`) };
  return here === norm(`/${s.handle}/${s.kinds[0]}`) ? { autoscroll: s.kinds[0], waitForProfile: false } : none;
}

/**
 * The profile is done (count captured or wait timed out): move on to the list. Null if not applicable.
 * `step` (the `startedAt` of the profile step a timer was armed for) keeps a late fallback timer from
 * advancing a later profile step that it was not meant for.
 */
export function advanceToList(s: AutoScan | undefined, tabId: number | undefined, now: number, step?: number): AutoScan | null {
  if (!s || s.phase !== 'profile' || (tabId !== undefined && tabId !== s.tabId)) return null;
  if (step !== undefined && step !== s.startedAt) return null;
  return { ...s, phase: 'list', startedAt: now };
}

/** A list finished: the next kind (starting again at the profile), or null when all are done. */
export function afterKindDone(s: AutoScan, now: number): AutoScan | null {
  const rest = s.kinds.slice(1);
  return rest.length ? { ...s, kinds: rest, phase: 'profile', startedAt: now } : null;
}

/** Start the verify phase once the lists are done, or null when no profile needs a visit. */
export function startChecks(s: AutoScan, toCheck: ToCheck[], now: number): AutoScan | null {
  const queue = toCheck.slice(0, MAX_CHECKS);
  if (!queue.length) return null;
  return { ...s, kinds: [], phase: 'verify', startedAt: now, queue, queueTotal: queue.length, eventIds: [] };
}

/**
 * The current profile was checked (or the wait for it ran out): drop it from the queue. Null if
 * `userId` is not the profile being checked, e.g. a late timer for a step already done.
 */
export function afterCheck(s: AutoScan | undefined, userId: string, now: number, eventId?: number): AutoScan | null {
  if (!s || s.phase !== 'verify' || s.queue?.[0]?.userId !== userId) return null;
  const eventIds = eventId === undefined ? (s.eventIds ?? []) : [...(s.eventIds ?? []), eventId];
  return { ...s, queue: s.queue.slice(1), eventIds, startedAt: now };
}
