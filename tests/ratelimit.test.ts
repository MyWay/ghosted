import { describe, expect, it } from 'vitest';
import { DEFAULT_WAIT_MS, MAX_WAIT_MS, SKEW_WAIT_MS, resumeAfterLimit, resumeAfterPage } from '../src/core/ratelimit';

const now = 1_700_000_000_000;
const inMin = (m: number) => (now + m * 60_000) / 1000;

describe('resumeAfterLimit (X refused a page)', () => {
  it('waits until just after the reset X names', () => {
    const at = resumeAfterLimit({ limit: 50, remaining: 0, reset: inMin(12) }, now)!;
    expect(at).toBeGreaterThan(now + 12 * 60_000);
    expect(at).toBeLessThan(now + 13 * 60_000);
  });
  it('waits a full window when X sends no reset time', () => {
    expect(resumeAfterLimit(undefined, now)).toBe(now + DEFAULT_WAIT_MS);
    expect(resumeAfterLimit({ limit: 50 }, now)).toBe(now + DEFAULT_WAIT_MS);
  });
  it('waits briefly when the reset has already passed by the local clock', () => {
    expect(resumeAfterLimit({ reset: inMin(-1) }, now)).toBe(now + SKEW_WAIT_MS);
  });
  it('does not wait for a reset that is too far away', () => {
    expect(resumeAfterLimit({ reset: (now + MAX_WAIT_MS + 60_000) / 1000 }, now)).toBeUndefined();
  });
});

describe('resumeAfterPage (a page loaded fine)', () => {
  it('waits only when that page used the last request of the window', () => {
    expect(resumeAfterPage({ limit: 50, remaining: 0, reset: inMin(10) }, now)).toBeGreaterThan(now + 10 * 60_000);
    expect(resumeAfterPage({ limit: 50, remaining: 1, reset: inMin(10) }, now)).toBeUndefined();
    expect(resumeAfterPage({ limit: 50, reset: inMin(10) }, now)).toBeUndefined();
    expect(resumeAfterPage(undefined, now)).toBeUndefined();
  });
  it('ignores counters without a usable reset', () => {
    expect(resumeAfterPage({ remaining: 0 }, now)).toBeUndefined();
    expect(resumeAfterPage({ remaining: 0, reset: inMin(-1) }, now)).toBeUndefined();
    expect(resumeAfterPage({ remaining: 0, reset: inMin(90) }, now)).toBeUndefined();
  });
});
