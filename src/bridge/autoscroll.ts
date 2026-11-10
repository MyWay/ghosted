import type { ListKind } from '../core/types';
import type { CaptureReply } from '../messages';
import { PACES, randomIn, type PaceConfig } from '../core/pace';
import { MAX_STALLED_WAITS } from '../core/ratelimit';

export interface Progress {
  collected: number;
  expected?: number;
  note?: string;
}

export type Outcome = 'complete' | 'invalid' | 'stopped' | 'timeout' | 'rate-limited';

const NO_PROGRESS_LIMIT_MS = 3 * 60 * 1000;
/** How long to wait for X to answer after reaching the bottom. */
const CAPTURE_TIMEOUT_MS = 4000;
const NUDGE_AFTER_MS = 8000;

/** Random extra wait after X's limit resets, so the next request is not sent on the dot. */
const RESUME_JITTER_MS: [number, number] = [2_000, 8_000];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ScrollerCallbacks {
  onProgress: (p: Progress) => void;
  onDone: (o: Outcome) => void;
  /** X's limit is used up: the scan waits until `until` (ms), then continues by itself. */
  onWait?: (until: number) => void;
  /** The wait is over but the tab is in the background; the scan continues once it is looked at. */
  onReady?: () => void;
  /** The wait is over and the scan is moving again. */
  onResume?: () => void;
}

/**
 * The control X shows under a list when a page failed to load ("Retry"). Found by position, not
 * by its label, so it works in every language: the last list row that is not an account.
 */
export function retryButton(root: ParentNode = document): HTMLElement | null {
  const column = root.querySelector('[data-testid="primaryColumn"]') ?? root;
  const rows = [...column.querySelectorAll('[data-testid="cellInnerDiv"]')].filter(
    (row) => !row.querySelector('[data-testid="UserCell"]'),
  );
  for (const row of rows.reverse()) {
    const button = row.querySelector<HTMLElement>('button, [role="button"]');
    if (button) return button;
  }
  return null;
}

/**
 * Drives the page scroll for an assisted scan. Each step jumps to the bottom of the list, which
 * makes X fetch the next page, then waits for that page to be captured plus a short jitter.
 * Jumping cannot skip accounts: the data comes from X's own requests, which always walk the
 * cursor chain one page at a time, not from the (virtualized) DOM.
 * Speed is ultimately bounded by X's response time and rate limits. X allows a fixed number of
 * list pages per window; a longer list waits for the window to reset and continues from the same
 * place, as long as the page stays open (a reload starts the list from the top again).
 */
export class AutoScroller {
  private running = false;
  private paused = false;
  private waiter: (() => void) | null = null;
  private lastProgressAt = Date.now();
  private lastCollected = -1;
  private finished: Outcome | null = null;
  /** Waiting for X's limit to reset until this time (ms). */
  private resumeAt: number | null = null;
  /** X refused the last page, so it has to be asked for again after the wait. */
  private retryAfterWait = false;
  private readyTold = false;
  /** Waits since the last new page. */
  private stalledWaits = 0;
  private onVisible = () => this.waiter?.();

  constructor(
    private kind: ListKind,
    private cb: ScrollerCallbacks,
    private pace: PaceConfig = PACES.normal,
  ) {}

  setPaused(p: boolean) {
    this.paused = p;
  }

  stop() {
    this.finish('stopped');
  }

  onCapture(reply: CaptureReply) {
    if (this.finished || !reply.handled || reply.kind !== this.kind) return;
    if (reply.rateLimited) {
      // Refused again while already waiting (X retrying by itself): same wait, not a new one.
      if (this.resumeAt !== null && reply.resumeAt !== undefined) return this.hold(reply.resumeAt, true);
      if (reply.resumeAt === undefined || this.stalledWaits >= MAX_STALLED_WAITS) return this.finish('rate-limited');
      this.stalledWaits++;
      return this.hold(reply.resumeAt, true);
    }
    if (reply.collected !== undefined && reply.collected !== this.lastCollected) {
      this.lastCollected = reply.collected;
      this.lastProgressAt = Date.now();
      this.stalledWaits = 0;
    }
    this.cb.onProgress({ collected: reply.collected ?? 0, expected: reply.expected });
    if (reply.status === 'committed' || reply.status === 'needs_review') return this.finish('complete');
    if (reply.status === 'invalid' || reply.status === 'error') return this.finish('invalid');
    // That was the last page X allows for now: wait for the reset instead of running into the limit.
    if (reply.resumeAt !== undefined) return this.hold(reply.resumeAt, false);
    this.waiter?.();
  }

  private hold(until: number, retry: boolean) {
    const at = until + randomIn(RESUME_JITTER_MS);
    this.resumeAt = Math.max(this.resumeAt ?? 0, at);
    this.retryAfterWait ||= retry;
    this.cb.onWait?.(this.resumeAt);
    this.waiter?.();
  }

  /** `replay`: the last capture seen before the scroller existed (it may already be final). */
  start(replay?: CaptureReply) {
    if (this.running || this.finished) return;
    this.running = true;
    globalThis.document?.addEventListener('visibilitychange', this.onVisible);
    void this.loop();
    if (replay) this.onCapture(replay);
  }

  private finish(outcome: Outcome) {
    if (this.finished) return;
    this.finished = outcome;
    this.running = false;
    globalThis.document?.removeEventListener('visibilitychange', this.onVisible);
    this.waiter?.();
    this.cb.onDone(outcome);
  }

  private waitForCapture(timeoutMs: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.waiter = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }

  private async loop() {
    // Let the first page (requested without a cursor by X itself) arrive before scrolling.
    await this.waitForCapture(8000);
    while (this.running) {
      if (this.paused) {
        await sleep(500);
        this.lastProgressAt = Date.now();
        continue;
      }
      if (this.resumeAt !== null) {
        this.lastProgressAt = Date.now();
        const due = Date.now() >= this.resumeAt;
        // X only loads more of a list in a tab that is being looked at.
        if (!due || document.hidden) {
          if (due && !this.readyTold) {
            this.readyTold = true;
            this.cb.onReady?.();
          }
          await this.waitForCapture(1000);
          continue;
        }
        const retry = this.retryAfterWait;
        this.resumeAt = null;
        this.retryAfterWait = false;
        this.readyTold = false;
        this.cb.onResume?.();
        if (retry) retryButton()?.click();
      }
      const idleFor = Date.now() - this.lastProgressAt;
      if (idleFor > NO_PROGRESS_LIMIT_MS) return this.finish('timeout');
      // If nothing new has loaded for a while, move up a screen first so X's lazy loader re-fires.
      if (idleFor > NUDGE_AFTER_MS) {
        window.scrollBy({ top: -window.innerHeight });
        await sleep(250);
      }
      const el = document.scrollingElement ?? document.documentElement;
      window.scrollTo({ top: el.scrollHeight });
      await this.waitForCapture(CAPTURE_TIMEOUT_MS);
      if (!this.running) return;
      await sleep(randomIn(this.pace.pageWaitMs));
    }
  }
}
