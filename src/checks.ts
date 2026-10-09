import { CHECK_WAIT_MS, afterCheck, readProfile, startChecks, urlFor, type AutoScan, type CheckOutcome } from './core/autoscan';
import type { Repo } from './db/repo';
import type { EventRow } from './db/schema';
import type { ChecksDone } from './messages';

/** What the profile checks need from the browser; injected so the flow can be tested. */
export interface CheckDeps {
  repo: Repo;
  now(): number;
  load(): Promise<AutoScan | undefined>;
  save(scan: AutoScan | null): Promise<void>;
  /** Send the check's tab to a page. */
  open(tabId: number, url: string): Promise<void>;
  /** Run `fn` after `ms`, serialized with captures. */
  later(fn: () => Promise<void>, ms: number): void;
  /** Pause before the next profile, from the check speed. */
  pause(): Promise<number>;
  /** Alert about recorded departures. */
  notify(ownerId: string, events: EventRow[]): void;
  tell(tabId: number, msg: ChecksDone): Promise<void>;
  /** X is limiting requests: record it and tell the user. */
  rateLimited(): Promise<void>;
}

/**
 * The end of an assisted check: visit the profile of each follower held as a departure, one at a
 * time, and report only those whose profile says they no longer follow you. Anything that stops
 * the visits (a rate limit, the Stop button, a closed tab) leaves the rest held for the next check.
 */
export class ProfileChecks {
  constructor(private d: CheckDeps) {}

  private ownerId() {
    return this.d.repo.getSetting<string | undefined>('ownerId', undefined);
  }

  /** The lists are done: start the visits. Returns how many profiles will be checked (0: none). */
  async start(scan: AutoScan): Promise<number> {
    const ownerId = await this.ownerId();
    if (!ownerId) return 0;
    const next = startChecks(scan, await this.d.repo.pendingDepartures(ownerId), this.d.now());
    if (!next) return 0;
    await this.d.save(next);
    this.d.later(() => this.openCurrent(), await this.d.pause());
    return next.queue!.length;
  }

  private async openCurrent() {
    const scan = await this.d.load();
    if (scan?.phase === 'verify' && scan.queue?.length) await this.d.open(scan.tabId, urlFor(scan));
  }

  /** The tab loaded the profile being checked: give X a while to answer. */
  pageReady(scan: AutoScan) {
    const userId = scan.queue?.[0]?.userId;
    if (userId) this.d.later(() => this.finish(userId, 'unknown'), CHECK_WAIT_MS);
  }

  /** A profile response captured in `tabId`. */
  async onProfile(tabId: number | undefined, status: number, body: unknown) {
    const scan = await this.d.load();
    const head = scan?.phase === 'verify' && scan.tabId === tabId ? scan.queue?.[0] : undefined;
    if (!scan || !head) return;
    const reading = readProfile(status, body, head.userId);
    if (reading === null) return;
    if (reading === 'rate-limited') {
      await this.d.rateLimited();
      await this.end(scan, { rateLimited: true });
      return;
    }
    await this.finish(head.userId, reading);
  }

  /** Record one profile check (or its timeout), then open the next profile or end. */
  async finish(userId: string, outcome: CheckOutcome) {
    const scan = await this.d.load();
    const ownerId = await this.ownerId();
    if (!scan || !ownerId || scan.queue?.[0]?.userId !== userId) return;
    const now = this.d.now();
    const event = await this.d.repo.resolveDeparture(ownerId, userId, outcome, now);
    const next = afterCheck(scan, userId, now, event?.id);
    if (!next) return;
    if (next.queue?.length) {
      await this.d.save(next);
      this.d.later(() => this.openCurrent(), await this.d.pause());
      return;
    }
    await this.end(next);
  }

  /** The Stop button on a profile page. */
  async stop() {
    const scan = await this.d.load();
    if (scan?.phase === 'verify') await this.end(scan);
  }

  /** End the visits: alert about the departures they recorded, in one batch. The rest stay held. */
  private async end(scan: AutoScan, opts: { rateLimited?: boolean } = {}) {
    await this.d.save(null);
    const ownerId = await this.ownerId();
    const recorded = (await this.d.repo.db.events.bulkGet(scan.eventIds ?? [])).filter((e): e is EventRow => !!e);
    if (ownerId && recorded.length) this.d.notify(ownerId, recorded);
    await this.d.tell(scan.tabId, { type: 'checks-done', ...(opts.rateLimited ? { rateLimited: true } : {}) });
  }

  /** Held departures no check reached in time are reported without one. */
  async expire() {
    const ownerId = await this.ownerId();
    if (!ownerId) return;
    const events = await this.d.repo.expirePending(ownerId, this.d.now());
    if (events.length) this.d.notify(ownerId, events);
  }
}
