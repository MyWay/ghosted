import type { ListKind } from '../core/types';
import type { CaptureReply } from '../messages';
import { PACES, randomIn, type PaceConfig } from '../core/pace';

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Drives the page scroll for an assisted scan. Each step jumps to the bottom of the list, which
 * makes X fetch the next page, then waits for that page to be captured plus a short jitter.
 * Jumping cannot skip accounts: the data comes from X's own requests, which always walk the
 * cursor chain one page at a time, not from the (virtualized) DOM.
 * Speed is ultimately bounded by X's response time and rate limits; a 429 stops the scan.
 */
export class AutoScroller {
  private running = false;
  private paused = false;
  private waiter: (() => void) | null = null;
  private lastProgressAt = Date.now();
  private lastCollected = -1;
  private finished: Outcome | null = null;

  constructor(
    private kind: ListKind,
    private cb: { onProgress: (p: Progress) => void; onDone: (o: Outcome) => void },
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
    if (reply.rateLimited) return this.finish('rate-limited');
    if (reply.collected !== undefined && reply.collected !== this.lastCollected) {
      this.lastCollected = reply.collected;
      this.lastProgressAt = Date.now();
    }
    this.cb.onProgress({ collected: reply.collected ?? 0, expected: reply.expected });
    if (reply.status === 'committed' || reply.status === 'needs_review') return this.finish('complete');
    if (reply.status === 'invalid' || reply.status === 'error') return this.finish('invalid');
    this.waiter?.();
  }

  /** `replay`: the last capture seen before the scroller existed (it may already be final). */
  start(replay?: CaptureReply) {
    if (this.running || this.finished) return;
    this.running = true;
    void this.loop();
    if (replay) this.onCapture(replay);
  }

  private finish(outcome: Outcome) {
    if (this.finished) return;
    this.finished = outcome;
    this.running = false;
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
