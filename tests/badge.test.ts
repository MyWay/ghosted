import { describe, expect, it } from 'vitest';
import { badgeText, isDeparture } from '../src/notify/badge';
import type { EventRow } from '../src/db/schema';

describe('badge', () => {
  it('formats counts', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(120)).toBe('99+');
  });
  it('counts only departures', () => {
    const ev = (type: EventRow['type']) => ({ type }) as EventRow;
    expect(['LOST_FOLLOWER', 'LOST_MUTUAL', 'NEW_FOLLOWER', 'UNFOLLOWED_BY_ME', 'RENAME'].map((t) => isDeparture(ev(t as EventRow['type'])))).toEqual([true, true, false, false, false]);
  });
});
