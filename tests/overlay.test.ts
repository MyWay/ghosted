import { describe, expect, it } from 'vitest';
import { age, countdown, doneText, resumeText, skippedText, titleText, waitText } from '../src/bridge/overlay';

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

describe('skipped lists', () => {
  const now = Date.now();
  const fresh = { kind: 'following' as const, reason: 'fresh' as const, checkedAt: now - 20 * 3_600_000 };
  const budget = { kind: 'following' as const, reason: 'budget' as const };

  it('says why a requested list is not in this check', () => {
    expect(skippedText([fresh], now)).toBe('Following was skipped: it was checked 20 h ago.');
    expect(skippedText([budget], now)).toBe("Following is left for your next check, so this one stays under X's limit.");
    expect(skippedText(undefined, now)).toBe('');
  });

  it('the title names the list that runs and the one that waits', () => {
    expect(titleText(undefined, 'followers', [budget])).toBe('Ghosted · checking followers (following next time)');
    expect(titleText({ index: 1, total: 2 }, 'followers')).toBe('Ghosted · checking list 1 of 2');
    expect(titleText({ index: 1, total: 1 }, 'followers')).toBe('Ghosted · checking');
  });

  it('the final message adds the note; mid-check messages do not', () => {
    expect(doneText('complete', { kind: 'followers', skipped: [budget] }).text).toBe(
      "Check complete. You can close this tab. Following is left for your next check, so this one stays under X's limit.",
    );
    expect(doneText('rate-limited', { kind: 'followers', skipped: [budget] }).text).toMatch(/Following is left for your next check/);
    expect(doneText('complete', { kind: 'followers', checks: 2, skipped: [budget] }).text).not.toMatch(/next check/);
  });

  it('formats ages', () => {
    expect([10 * 60_000, 20 * 3_600_000, 72 * 3_600_000].map(age)).toEqual(['under an hour', '20 h', '3 days']);
  });
});

describe('countdown', () => {
  it('formats seconds and minutes', () => {
    expect([0, 400, 5_000, 59_100, 60_000, 90_000, -5].map(countdown)).toEqual(['0 s', '1 s', '5 s', '1 min', '1 min', '1 min 30 s', '0 s']);
  });
});

describe('waiting for X\'s limit', () => {
  it('says how far the list got, that it continues by itself, and to keep the tab', () => {
    const t = waitText('followers', { collected: 2450, expected: 2550 });
    expect(t).toMatch(/^Followers: 2450 of ~2550 collected so far\./);
    expect(t).toMatch(/carries on from here/);
    expect(t).toMatch(/Keep this tab open \(do not reload it\); you can use other tabs/);
    expect(waitText('followers')).toMatch(/^X only lets/);
  });
  it('counts down to the time the list continues', () => {
    const now = Date.now();
    expect(resumeText(now + 90_000, now)).toMatch(/^Continues at .+ \(in 1 min 30 s\)$/);
    expect(resumeText(now - 1, now)).toBe('Continuing…');
  });
});
