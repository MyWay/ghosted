import type { ListKind } from './core/types';
import type { Pace } from './core/pace';
import type { ScanStatus } from './db/schema';

export const CHANNEL = 'ghosted';

/** Page (MAIN world) -> bridge (isolated world), via window.postMessage. */
export interface PageCapture {
  channel: typeof CHANNEL;
  url: string;
  status: number;
  body: unknown;
  /** Request body, only for captured unfollow requests (form-encoded `user_id=...`). */
  requestBody?: string;
}

/** Bridge -> background. */
export type ToBackground =
  | { type: 'capture'; url: string; status: number; body: unknown; requestBody?: string }
  | { type: 'bridge-ready'; path: string }
  | { type: 'owner-handle'; handle: string }
  | { type: 'scan-finished'; kind: ListKind; outcome: 'complete' | 'invalid' | 'stopped' | 'timeout' | 'rate-limited' }
  // popup / dashboard -> background
  | { type: 'start-scan'; kinds: ListKind[] }
  | { type: 'resolve-review'; scanId: number; accept: boolean }
  | { type: 'test-notify'; channel: 'browser' | 'telegram' | 'discord' };

export interface CaptureReply {
  handled: boolean;
  ignored?: 'not-owner' | 'unknown-owner' | 'irrelevant';
  status?: ScanStatus | 'error';
  reason?: string;
  collected?: number;
  expected?: number;
  kind?: ListKind;
  rateLimited?: boolean;
}

export interface BridgeReadyReply {
  autoscroll: ListKind | null;
  /** Check speed chosen in Settings. */
  pace?: Pace;
}

export interface CommandReply {
  ok: boolean;
  error?: string;
}
