import { describe, expect, it } from 'vitest';
import { PACES, asPace, randomIn } from '../src/core/pace';

describe('pace', () => {
  it('gets slower from normal to careful to slow', () => {
    expect(PACES.normal.pageWaitMs[1]).toBeLessThan(PACES.careful.pageWaitMs[0]);
    expect(PACES.careful.pageWaitMs[1]).toBeLessThan(PACES.slow.pageWaitMs[0]);
    expect(PACES.normal.betweenListsMs[1]).toBeLessThan(PACES.careful.betweenListsMs[0]);
  });
  it('uses alarm-safe (>= 30s) pauses between lists for the slower paces', () => {
    expect(PACES.careful.betweenListsMs[0]).toBeGreaterThanOrEqual(30_000);
    expect(PACES.slow.betweenListsMs[0]).toBeGreaterThanOrEqual(30_000);
  });
  it('falls back to normal for unknown values', () => {
    expect(asPace('slow')).toBe('slow');
    expect(asPace('warp')).toBe('normal');
    expect(asPace(undefined)).toBe('normal');
  });
  it('picks a value inside the range', () => {
    expect(randomIn([100, 200], () => 0)).toBe(100);
    expect(randomIn([100, 200], () => 0.5)).toBe(150);
  });
});
