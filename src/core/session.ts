import type { ListKind, ParsedPage } from './types';

/** Serializable scan-session state. Persisted to IndexedDB after every page. */
export interface SessionState {
  ownerId: string;
  kind: ListKind;
  startedAt: number;
  lastPageAt: number;
  /** The first captured request had no cursor, i.e. we saw the top of the list. */
  startedFromTop: boolean;
  /** Every bottom cursor X handed us; a follow-up request must use one of them. */
  bottomCursors: string[];
  /** Top cursors (used by X to poll for newer entries). Requests with them are side pages. */
  topCursors: string[];
  /** Cursors already requested; a repeat is a retry / re-fetch and must not move the session. */
  requestedCursors: string[];
  pages: number;
  /** Unique users collected so far (maintained by the caller from persisted items). */
  collected: number;
  warnings: number;
  unavailable: number;
  /** Ids of unavailable entries: still on the list, just not shown. Absent in older states. */
  unavailableIds?: string[];
  gap: boolean;
  endReached: boolean;
}

export interface PageInput {
  ownerId: string;
  kind: ListKind;
  requestCursor?: string;
  page: ParsedPage;
  /** Unique users collected in the session after storing this page. */
  collectedTotal: number;
  now: number;
}

/** Session idle timeout before it is abandoned. */
export const SESSION_IDLE_MS = 10 * 60 * 1000;
/**
 * Minimum share of X's follower/following counter that a scan must collect. X's list is usually a
 * little shorter than the counter (suspended / unlisted accounts), so this is deliberately loose:
 * truncation is already caught by the cursor-chain checks and by the mass-removal review guard.
 */
export const DEFAULT_THRESHOLD = 0.9;

const isTerminalCursor = (c: string | undefined) => !c || c.startsWith('0|');
const add = (list: string[], v: string | undefined) => (v && !list.includes(v) ? [...list, v] : list);
const addAll = (list: string[] = [], vs: string[] = []) => vs.reduce(add, list);

function emptyState(input: PageInput): SessionState {
  return {
    ownerId: input.ownerId,
    kind: input.kind,
    startedAt: input.now,
    lastPageAt: input.now,
    startedFromTop: input.requestCursor === undefined,
    bottomCursors: [],
    topCursors: [],
    requestedCursors: [],
    pages: 0,
    collected: 0,
    warnings: 0,
    unavailable: 0,
    gap: false,
    endReached: false,
  };
}

/**
 * Advance a session with one captured page. A request without a cursor always starts a new
 * session; `state` is ignored in that case.
 *
 * Only pages on the bottom-cursor chain can end the session. Pages fetched with a top cursor
 * (X polling for newer entries) or with an already-requested cursor (retries, re-renders) only
 * contribute users, never an end-of-list signal.
 */
export function applyPage(state: SessionState | null, input: PageInput): SessionState {
  const { page, requestCursor } = input;
  const fresh = requestCursor === undefined || !state;
  // Older persisted states may predate the cursor lists.
  const base: SessionState = fresh
    ? emptyState(input)
    : { ...state!, topCursors: state!.topCursors ?? [], requestedCursors: state!.requestedCursors ?? [] };

  const counters = {
    lastPageAt: input.now,
    collected: input.collectedTotal,
    topCursors: add(base.topCursors, page.topCursor),
    unavailableIds: addAll(base.unavailableIds, page.unavailableIds),
  };

  if (!fresh && requestCursor && (base.topCursors.includes(requestCursor) || base.requestedCursors.includes(requestCursor))) {
    return { ...base, ...counters, warnings: base.warnings + page.warnings };
  }

  const gap = !fresh && !!requestCursor && !base.bottomCursors.includes(requestCursor);
  const cursorRepeated = !!page.bottomCursor && base.bottomCursors.includes(page.bottomCursor);

  return {
    ...base,
    ...counters,
    bottomCursors: cursorRepeated ? base.bottomCursors : add(base.bottomCursors, page.bottomCursor),
    requestedCursors: add(base.requestedCursors, requestCursor),
    pages: base.pages + 1,
    warnings: base.warnings + page.warnings,
    unavailable: base.unavailable + page.unavailable,
    gap: base.gap || gap,
    endReached:
      base.endReached || page.users.length === 0 || isTerminalCursor(page.bottomCursor) || cursorRepeated,
  };
}

export type Verdict =
  | { status: 'collecting' }
  | { status: 'invalid'; reason: string }
  | { status: 'complete'; expectedKnown: boolean };

export function evaluate(state: SessionState, expected: number | undefined, threshold = DEFAULT_THRESHOLD): Verdict {
  if (!state.endReached) return { status: 'collecting' };
  if (!state.startedFromTop) return { status: 'invalid', reason: 'scan did not start at the top of the list' };
  if (state.gap) return { status: 'invalid', reason: 'gap in the cursor chain' };
  if (state.warnings > 0) return { status: 'invalid', reason: `${state.warnings} entries failed to parse` };
  if (expected !== undefined && expected > 0) {
    const seen = state.collected + state.unavailable;
    if (seen < expected * threshold) {
      return { status: 'invalid', reason: `collected ${seen} of ~${expected} (below ${Math.round(threshold * 100)}%)` };
    }
  }
  return { status: 'complete', expectedKnown: expected !== undefined };
}

export function isStale(state: SessionState, now: number): boolean {
  return now - state.lastPageAt > SESSION_IDLE_MS;
}

/**
 * Whether removing `removed` of `prevSize` members is suspicious enough to need confirmation.
 * `strict` applies when the scan could not be checked against a fresh profile count.
 */
export function needsReview(prevSize: number, removed: number, strict = false): boolean {
  const [minAbsolute, fraction] = strict ? [5, 0.01] : [25, 0.05];
  return removed > Math.max(minAbsolute, Math.floor(prevSize * fraction));
}
