import { describe, expect, it } from 'vitest';
import { advanceToList, afterKindDone, answerBridgeReady, newAutoScan, stepOf, urlFor } from '../src/core/autoscan';

const scan = () => newAutoScan(7, ['following', 'followers'], 'maya', 1000);

describe('autoscan phases', () => {
  it('starts on the profile page, then moves to the first list', () => {
    const s = scan();
    expect(urlFor(s)).toBe('https://x.com/maya');
    const list = advanceToList(s, 7, 2000)!;
    expect(list.phase).toBe('list');
    expect(list.startedAt).toBe(2000);
    expect(urlFor(list)).toBe('https://x.com/maya/following');
  });

  it('only advances once, and only for its own tab', () => {
    const s = scan();
    expect(advanceToList(s, 99, 2000)).toBeNull();
    const list = advanceToList(s, 7, 2000)!;
    expect(advanceToList(list, 7, 3000)).toBeNull();
    expect(advanceToList(undefined, 7, 3000)).toBeNull();
  });

  it('waits on the profile page, scrolls only on the right list page', () => {
    const s = scan();
    expect(answerBridgeReady(s, 7, '/maya')).toEqual({ autoscroll: null, waitForProfile: true });
    expect(answerBridgeReady(s, 7, '/Maya/')).toEqual({ autoscroll: null, waitForProfile: true });
    expect(answerBridgeReady(s, 7, '/maya/following')).toEqual({ autoscroll: null, waitForProfile: false });
    const list = advanceToList(s, 7, 2000)!;
    expect(answerBridgeReady(list, 7, '/maya/following')).toEqual({ autoscroll: 'following', waitForProfile: false });
    expect(answerBridgeReady(list, 7, '/maya')).toEqual({ autoscroll: null, waitForProfile: false });
  });

  it('ignores other tabs and missing state', () => {
    expect(answerBridgeReady(scan(), 8, '/maya')).toEqual({ autoscroll: null, waitForProfile: false });
    expect(answerBridgeReady(undefined, 7, '/maya')).toEqual({ autoscroll: null, waitForProfile: false });
  });

  it('visits the profile again before each further list, then stops', () => {
    const list = advanceToList(scan(), 7, 2000)!;
    const next = afterKindDone(list, 3000)!;
    expect(next).toMatchObject({ kinds: ['followers'], phase: 'profile', startedAt: 3000 });
    expect(urlFor(next)).toBe('https://x.com/maya');
    expect(urlFor(advanceToList(next, 7, 4000)!)).toBe('https://x.com/maya/followers');
    expect(afterKindDone(advanceToList(next, 7, 4000)!, 5000)).toBeNull();
  });
});

describe('profile fallback timer', () => {
  it('a late timer from the first profile step cannot skip the second profile step', () => {
    const first = newAutoScan(7, ['following', 'followers'], 'maya', 1000);
    const armedFor = first.startedAt;
    const list = advanceToList(first, 7, 1200)!;
    const secondProfile = afterKindDone(list, 5000)!;
    expect(advanceToList(secondProfile, 7, 9000, armedFor)).toBeNull();
    expect(advanceToList(secondProfile, 7, 9000, secondProfile.startedAt)?.phase).toBe('list');
    expect(advanceToList(secondProfile, 7, 9000)?.phase).toBe('list');
  });
});

describe('stepOf', () => {
  it('counts lists as the check moves on', () => {
    const first = advanceToList(scan(), 7, 2000)!;
    expect(stepOf(first)).toEqual({ index: 1, total: 2 });
    const second = afterKindDone(first, 3000)!;
    expect(stepOf(second)).toEqual({ index: 2, total: 2 });
    expect(stepOf(advanceToList(second, 7, 4000)!)).toEqual({ index: 2, total: 2 });
  });
  it('a single-list check is 1 of 1, and old saved state without a total still works', () => {
    expect(stepOf(newAutoScan(7, ['followers'], 'maya', 0))).toEqual({ index: 1, total: 1 });
    const { total: _, ...old } = scan();
    expect(stepOf(old)).toEqual({ index: 1, total: 2 });
  });
});
