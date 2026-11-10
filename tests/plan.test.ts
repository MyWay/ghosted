import { describe, expect, it } from 'vitest';
import { BOTH_LISTS_MAX, SKIP_FRESH_MS, planCheck, planKinds } from '../src/core/plan';

const NOW = 10_000_000_000;
const ago = (h: number) => NOW - h * 3_600_000;
const BIG = { followers: 2_579, following: 2_263 };
const SMALL = { followers: 400, following: 300 };

describe('planKinds', () => {
  it('a single-list request is explicit and runs exactly that list', () => {
    expect(planKinds(['following'], { followers: ago(48) }, NOW)).toEqual(['following']);
    expect(planKinds(['followers'], {}, NOW)).toEqual(['followers']);
  });

  it('with no committed scans a full check runs both, followers first', () => {
    expect(planKinds(['following', 'followers'], {}, NOW)).toEqual(['followers', 'following']);
  });

  it('drops lists with a fresh committed scan so the stale one gets the whole budget', () => {
    expect(planKinds(['following', 'followers'], { following: ago(2), followers: ago(30) }, NOW)).toEqual(['followers']);
    expect(planKinds(['following', 'followers'], { following: ago(30), followers: ago(2) }, NOW)).toEqual(['following']);
  });

  it('a scan just under the freshness window still counts as fresh', () => {
    expect(planKinds(['following', 'followers'], { following: NOW - (SKIP_FRESH_MS - 1), followers: ago(48) }, NOW)).toEqual(['followers']);
  });

  it('daily checks alternate the lists', () => {
    // Day 1: both stale on a big account, only the stalest (followers on a tie) runs.
    const day1 = planKinds(['following', 'followers'], { following: ago(50), followers: ago(50) }, NOW, BIG);
    expect(day1).toEqual(['followers']);
    const at = { followers: ago(0.5), following: ago(50) };
    expect(planKinds(['following', 'followers'], at, NOW + 24 * 3_600_000, BIG)).toEqual(['following']);
  });

  it('a big account with both lists stale reads only the stalest, so neither list starves', () => {
    // Checks days apart: both stale every time. Each check must advance a different list.
    expect(planKinds(['following', 'followers'], { followers: ago(72), following: ago(144) }, NOW, BIG)).toEqual(['following']);
    expect(planKinds(['following', 'followers'], { followers: ago(144), following: ago(72) }, NOW, BIG)).toEqual(['followers']);
    // A list never committed is the stalest.
    expect(planKinds(['following', 'followers'], { followers: ago(72) }, NOW, BIG)).toEqual(['following']);
  });

  it('a small account, or one of unknown size, still reads both stale lists in one check', () => {
    expect(planKinds(['following', 'followers'], { followers: ago(72), following: ago(144) }, NOW, SMALL)).toEqual(['followers', 'following']);
    expect(planKinds(['following', 'followers'], {}, NOW, { followers: BOTH_LISTS_MAX - 10, following: 10 })).toEqual(['followers', 'following']);
    expect(planKinds(['following', 'followers'], {}, NOW, { followers: BOTH_LISTS_MAX, following: 1 })).toEqual(['followers']);
    expect(planKinds(['following', 'followers'], {}, NOW, {})).toEqual(['followers', 'following']);
    // One known size already over the budget is enough to split.
    expect(planKinds(['following', 'followers'], {}, NOW, { followers: 5_000 })).toEqual(['followers']);
  });

  it('when everything is fresh the stalest list runs alone, so a check always makes progress', () => {
    expect(planKinds(['following', 'followers'], { following: ago(2), followers: ago(10) }, NOW)).toEqual(['followers']);
    expect(planKinds(['following', 'followers'], { following: ago(10), followers: ago(2) }, NOW)).toEqual(['following']);
    // A tie is deterministic: followers, the more important list.
    expect(planKinds(['following', 'followers'], { following: ago(5), followers: ago(5) }, NOW)).toEqual(['followers']);
  });

  it('after a rate-limited run, the next check retries only the list that did not commit', () => {
    // The following list completed 20 minutes ago; the followers list died and has no fresh commit.
    const after = { following: ago(0.33) };
    expect(planKinds(['following', 'followers'], after, NOW)).toEqual(['followers']);
  });
});

describe('planCheck', () => {
  it('says which requested lists were left out, and why', () => {
    expect(planCheck(['following', 'followers'], { following: ago(2), followers: ago(48) }, NOW)).toEqual({
      kinds: ['followers'],
      skipped: [{ kind: 'following', reason: 'fresh', checkedAt: ago(2) }],
    });
    expect(planCheck(['following', 'followers'], { followers: ago(72) }, NOW, BIG)).toEqual({
      kinds: ['following'],
      skipped: [{ kind: 'followers', reason: 'budget', checkedAt: ago(72) }],
    });
  });

  it('nothing is skipped when every requested list runs', () => {
    expect(planCheck(['following', 'followers'], {}, NOW, SMALL).skipped).toEqual([]);
    expect(planCheck(['followers'], { following: ago(1) }, NOW).skipped).toEqual([]);
  });
});
