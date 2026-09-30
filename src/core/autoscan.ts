import type { ListKind } from './types';

/**
 * State of an assisted check. Each list is preceded by a visit to the owner's profile so X sends
 * a fresh follower/following count (UserByScreenName), which the completeness check needs.
 */
export interface AutoScan {
  tabId: number;
  kinds: ListKind[];
  handle: string;
  startedAt: number;
  phase: 'profile' | 'list';
}

/** How long to wait on the profile page for the count before moving on anyway. */
export const PROFILE_WAIT_MS = 8000;

export const newAutoScan = (tabId: number, kinds: ListKind[], handle: string, now: number): AutoScan => ({
  tabId,
  kinds,
  handle,
  startedAt: now,
  phase: 'profile',
});

/** Page the tab should be on for the current phase. */
export function urlFor(s: AutoScan): string {
  return s.phase === 'profile' ? `https://x.com/${s.handle}` : `https://x.com/${s.handle}/${s.kinds[0]}`;
}

const norm = (path: string) => path.toLowerCase().replace(/\/+$/, '');

export type BridgeAnswer = { autoscroll: ListKind | null; waitForProfile: boolean };

/** What a freshly loaded x.com page in `tabId` should do. */
export function answerBridgeReady(s: AutoScan | undefined, tabId: number | undefined, path: string): BridgeAnswer {
  const none = { autoscroll: null, waitForProfile: false };
  if (!s || tabId !== s.tabId) return none;
  const here = norm(path);
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
