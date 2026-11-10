import type { RateLimitHeaders } from '../messages';

/** Wait used when X refuses a page without saying when its limit resets (its windows are 15 minutes). */
export const DEFAULT_WAIT_MS = 15 * 60 * 1000;
/** A reset further away than this is not waited for: the check ends and the next one starts over. */
export const MAX_WAIT_MS = 30 * 60 * 1000;
/** Wait when X refuses a page although its reset time has passed by this computer's clock. */
export const SKEW_WAIT_MS = 60 * 1000;
/** Added to X's reset time, so the next request does not land a moment early. */
const MARGIN_MS = 5 * 1000;
/**
 * How long a waiting scan is kept after its limit resets. The list continues when its tab is
 * looked at again, which can be long after the reset; the scan must still be there then.
 */
export const HOLD_GRACE_MS = 2 * 60 * 60 * 1000;
/** Waits in a row that brought no new page before the check gives up: waiting is not helping. */
export const MAX_STALLED_WAITS = 2;

const resetMs = (h: RateLimitHeaders | undefined) => (h?.reset !== undefined ? h.reset * 1000 : undefined);

/**
 * X refused a list page (429): when the list can continue, or undefined when waiting is not worth
 * it. The page keeps its place in the list, so the same request works again after the reset.
 */
export function resumeAfterLimit(headers: RateLimitHeaders | undefined, now: number): number | undefined {
  const reset = resetMs(headers);
  if (reset === undefined) return now + DEFAULT_WAIT_MS;
  if (reset <= now) return now + SKEW_WAIT_MS;
  if (reset - now > MAX_WAIT_MS) return undefined;
  return reset + MARGIN_MS;
}

/**
 * A list page loaded fine but used the last request X allows in this window: when the next one
 * may be sent. Undefined when requests are left, or X sent no usable counters. Waiting here means
 * the check never runs into the limit at all.
 */
export function resumeAfterPage(headers: RateLimitHeaders | undefined, now: number): number | undefined {
  const reset = resetMs(headers);
  if (headers?.remaining !== 0 || reset === undefined) return undefined;
  if (reset <= now || reset - now > MAX_WAIT_MS) return undefined;
  return reset + MARGIN_MS;
}
