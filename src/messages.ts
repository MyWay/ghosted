import type { ListKind } from './core/types';
import type { Pace } from './core/pace';
import type { ScanStatus } from './db/schema';
import type { SkippedList } from './core/plan';

export const CHANNEL = 'ghosted';

/** Page (MAIN world) -> bridge (isolated world), via window.postMessage. */
export interface PageCapture {
  channel: typeof CHANNEL;
  url: string;
  status: number;
  body: unknown;
  /** Request body, only for captured unfollow requests (form-encoded `user_id=...`). */
  requestBody?: string;
  /** X's `x-rate-limit-*` response headers, when present. Never auth headers. */
  rateLimit?: RateLimitHeaders;
}

/** X's `x-rate-limit-limit / -remaining / -reset` (reset is a unix time in seconds). */
export interface RateLimitHeaders {
  limit?: number;
  remaining?: number;
  reset?: number;
}

/** Keeps only finite numbers from a page-supplied rate-limit object (the page world is untrusted). */
export function rateLimitFrom(v: unknown): RateLimitHeaders | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const out: RateLimitHeaders = { limit: num(o.limit), remaining: num(o.remaining), reset: num(o.reset) };
  return out.limit === undefined && out.remaining === undefined && out.reset === undefined ? undefined : out;
}

/** Bridge -> background. */
export type ToBackground =
  | { type: 'capture'; url: string; status: number; body: unknown; requestBody?: string; rateLimit?: RateLimitHeaders }
  | { type: 'bridge-ready'; path: string }
  | { type: 'owner-handle'; handle: string }
  | { type: 'scan-finished'; kind: ListKind; outcome: 'complete' | 'invalid' | 'stopped' | 'timeout' | 'rate-limited' }
  | { type: 'stop-checks' }
  // popup / dashboard -> background
  | { type: 'start-scan'; kinds: ListKind[] }
  | { type: 'resolve-review'; scanId: number; accept: boolean }
  | { type: 'test-notify'; channel: 'browser' | 'telegram' | 'discord' | 'webhook' };

export interface CaptureReply {
  handled: boolean;
  ignored?: 'not-owner' | 'unknown-owner' | 'irrelevant';
  status?: ScanStatus | 'error';
  reason?: string;
  collected?: number;
  expected?: number;
  kind?: ListKind;
  rateLimited?: boolean;
  /** The scan committed as the first one for this list: a starting point, so no changes yet. */
  baseline?: boolean;
}

export interface BridgeReadyReply {
  autoscroll: ListKind | null;
  /** Check speed chosen in Settings. */
  pace?: Pace;
  /** Position of this list in the check, for "1 of 2". */
  step?: { index: number; total: number };
  /** Requested lists this check leaves out, and why. */
  skipped?: SkippedList[];
  /** This page is the profile of a follower who seems to have left, visited to check. */
  checking?: { handle: string; index: number; total: number };
}

/** Background -> the check's tab, when the profile checks are over. */
export interface ChecksDone {
  type: 'checks-done';
  /** X limited requests, so the checks stopped early. */
  rateLimited?: boolean;
  /** Requested lists this check left out, and why. */
  skipped?: SkippedList[];
}

export interface ScanFinishedReply {
  ok: boolean;
  /** The list the check moves on to, and roughly when its page opens. */
  next?: { kind: ListKind; inMs: number };
  /** Profiles of followers who seem to have left, which the check visits next. */
  checks?: number;
}

export interface CommandReply {
  ok: boolean;
  error?: string;
}
