import { describe, expect, it } from 'vitest';
import { countdown, doneText } from '../src/bridge/overlay';

describe('doneText', () => {
  it('keeps the tab open while profile checks follow', () => {
    const r = doneText('complete', { kind: 'followers', checks: 2 });
    expect(r.keepOpen).toBe(true);
    expect(r.text).toMatch(/Keep this tab open: checking the profiles of 2 followers/);
    expect(doneText('stopped', { kind: 'followers', checks: 2 }).keepOpen).toBe(false);
  });
  const next = { kind: 'followers' as const, inMs: 40_000 };

  it('never sounds finished while another list follows', () => {
    const r = doneText('complete', { kind: 'following', next });
    expect(r.keepOpen).toBe(true);
    expect(r.text).toBe('Following list done. Keep this tab open: the followers list is next.');
    expect(r.text).not.toMatch(/complete|close/i);
  });
  it('an unverifiable first list still moves on', () => {
    const r = doneText('invalid', { kind: 'following', next });
    expect(r.keepOpen).toBe(true);
    expect(r.text).toMatch(/Keep this tab open/);
  });
  it('says complete only at the end, and explains the first check', () => {
    expect(doneText('complete', { kind: 'followers' })).toEqual({ text: 'Check complete. You can close this tab.', keepOpen: false });
    expect(doneText('complete', { kind: 'followers', baseline: true }).text).toMatch(/starting point: changes show from your next check/);
  });
  it('a stopped or rate-limited check ends, even if lists were left', () => {
    expect(doneText('stopped', { kind: 'following', next }).keepOpen).toBe(false);
    expect(doneText('rate-limited', { kind: 'following', next }).keepOpen).toBe(false);
  });
});

describe('countdown', () => {
  it('formats seconds and minutes', () => {
    expect([0, 400, 5_000, 59_100, 60_000, 90_000, -5].map(countdown)).toEqual(['0 s', '1 s', '5 s', '1 min', '1 min', '1 min 30 s', '0 s']);
  });
});
