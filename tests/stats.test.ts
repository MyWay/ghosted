import { describe, expect, it } from 'vitest';
import { countSeries, dailyChanges, delta, niceTicks, signed, totals } from '../src/ui/stats';
import type { EventRow, ScanRow } from '../src/db/schema';

const DAY = 86_400_000;

describe('totals', () => {
  it('derives mutuals, not-following-back and fans', () => {
    const following = [
      { userId: '1', handle: 'a', followsYou: true },
      { userId: '2', handle: 'b', followsYou: false },
      { userId: '3', handle: 'c' },
    ];
    const followers = [{ userId: '1', handle: 'a' }, { userId: '9', handle: 'z' }];
    expect(totals(following, followers)).toEqual({ followers: 2, following: 3, mutuals: 1, notFollowingBack: 1, fans: 1 });
  });
});

describe('countSeries / delta', () => {
  const scan = (t: number, v: number, status: ScanRow['status'] = 'committed', kind: ScanRow['kind'] = 'followers') =>
    ({ kind, status, endedAt: t, collected: v }) as ScanRow;
  const now = 100 * DAY;
  const scans = [scan(now - 10 * DAY, 100), scan(now - 3 * DAY, 104), scan(now, 101), scan(now - DAY, 5, 'invalid'), scan(now, 9, 'committed', 'following')];

  it('keeps committed scans of one kind, oldest first', () => {
    expect(countSeries(scans, 'followers').map((p) => p.v)).toEqual([100, 104, 101]);
  });
  it('computes change over a window', () => {
    const s = countSeries(scans, 'followers');
    expect(delta(s, 7 * DAY, now)).toBe(1);
    expect(delta(s, 2 * DAY, now)).toBe(-3);
    expect(delta(s.slice(0, 1), 7 * DAY, now)).toBeUndefined();
  });
});

describe('dailyChanges', () => {
  it('buckets follower gains and losses by local day', () => {
    const now = new Date(2026, 8, 29, 15).getTime();
    const ev = (daysAgo: number, type: EventRow['type']) => ({ at: now - daysAgo * DAY, type }) as EventRow;
    const days = dailyChanges([ev(0, 'NEW_FOLLOWER'), ev(0, 'LOST_FOLLOWER'), ev(1, 'LOST_FOLLOWER'), ev(1, 'RENAME'), ev(40, 'LOST_FOLLOWER')], 7, now);
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ gained: 1, lost: 1 });
    expect(days[5]).toMatchObject({ gained: 0, lost: 1 });
    expect(days.reduce((a, d) => a + d.lost, 0)).toBe(2);
  });
});

describe('niceTicks / signed', () => {
  it('produces round ticks covering the range', () => {
    expect(niceTicks(0, 1000)).toEqual([0, 250, 500, 750, 1000]);
    const t = niceTicks(1203, 1291);
    expect(t[0]).toBeLessThanOrEqual(1203);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(1291);
    expect(niceTicks(50, 50).length).toBeGreaterThan(1);
  });
  it('formats signed deltas', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(-1200)).toBe(`−${(1200).toLocaleString()}`);
    expect(signed(0)).toBe('±0');
  });
});

describe('niceTicks integer mode', () => {
  it('never produces fractional steps for counts', () => {
    for (const [lo, hi] of [[-3, 6], [-1, 1], [0, 3], [-5, 10]]) {
      expect(niceTicks(lo, hi, 4, true).every(Number.isInteger)).toBe(true);
    }
  });
});
