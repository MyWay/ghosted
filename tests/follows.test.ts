import { describe, expect, it } from 'vitest';
import { cycleBadge, distinctChanges, findBoomerangs, withoutRepeats, type FollowEvent } from '../src/core/follows';
import { unseenDepartures } from '../src/notify/badge';
import type { EventRow } from '../src/db/schema';

const H = 3_600_000;
let nextId = 1;
const ev = (type: FollowEvent['type'], userId: string, at: number, reason?: FollowEvent['reason']) =>
  ({ id: nextId++, ownerId: 'me', scanId: 1, type, userId, handle: `u${userId}`, at, reason }) as EventRow;

describe('distinctChanges', () => {
  it('drops the second list reporting the same departure', () => {
    // Same scan run: the following scan says "stopped following you back", the followers scan "unfollowed you".
    const events = [ev('LOST_MUTUAL', '1', 10 * H), ev('LOST_FOLLOWER', '1', 10 * H + 60_000)];
    expect(distinctChanges(events).map((e) => e.type)).toEqual(['LOST_MUTUAL']);
  });
  it('ignores non follower events', () => {
    expect(distinctChanges([ev('RENAME', '1', 0), ev('NEW_FOLLOWING', '1', 0)])).toEqual([]);
  });
});

describe('withoutRepeats', () => {
  it('keeps new events unless the history shows the other list already reported them', () => {
    const first = ev('LOST_MUTUAL', '1', 0);
    const again = ev('LOST_FOLLOWER', '1', H);
    const other = ev('LOST_FOLLOWER', '2', H);
    expect(withoutRepeats([again, other], [first, again, other])).toEqual([other]);
  });
  it('keeps events without ids', () => {
    const e = { type: 'LOST_FOLLOWER', userId: '1', handle: 'a', at: 0 } as FollowEvent;
    expect(withoutRepeats([e], [ev('LOST_FOLLOWER', '1', 0)])).toEqual([e]);
  });
});

describe('unseenDepartures', () => {
  it('does not count a departure again when the other list reports it after it was seen', () => {
    const seen = ev('LOST_MUTUAL', '1', 0);
    const late = ev('LOST_FOLLOWER', '1', H);
    const fresh = ev('LOST_FOLLOWER', '2', H);
    expect(unseenDepartures([fresh, late, seen], seen.id!)).toEqual([fresh]);
  });
});

describe('findBoomerangs', () => {
  it('counts each follow-then-leave once, across both lists', () => {
    const events = [
      ev('LOST_MUTUAL', '1', 1 * H),
      ev('LOST_FOLLOWER', '1', 2 * H),
      ev('NEW_FOLLOWER', '1', 24 * H),
      ev('NEW_MUTUAL', '1', 25 * H),
      ev('LOST_FOLLOWER', '1', 48 * H),
      ev('LOST_FOLLOWER', '2', 48 * H),
    ];
    const [b, ...rest] = findBoomerangs(events);
    expect(rest).toEqual([]);
    expect(b).toMatchObject({ userId: '1', cycles: 2, lastLeftAt: 48 * H });
    expect(b.history.map((h) => h.change)).toEqual(['loss', 'gain', 'loss']);
  });
  it('does not count suspended / deleted accounts', () => {
    const events = [ev('LOST_FOLLOWER', '1', 0, 'likely_gone'), ev('NEW_FOLLOWER', '1', H), ev('LOST_FOLLOWER', '1', 2 * H)];
    expect(findBoomerangs(events)).toEqual([]);
  });
  it('sorts by cycles, then most recent departure', () => {
    const cycle = (u: string, start: number, n: number) =>
      Array.from({ length: n }, (_, i) => [ev('NEW_FOLLOWER', u, start + i * 2 * H), ev('LOST_FOLLOWER', u, start + (i * 2 + 1) * H)]).flat();
    const order = findBoomerangs([...cycle('a', 0, 2), ...cycle('b', 100 * H, 2), ...cycle('c', 0, 3)]).map((b) => b.userId);
    expect(order).toEqual(['c', 'b', 'a']);
  });
});

describe('cycleBadge', () => {
  it('assigns tiers', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => cycleBadge(n)?.tier ?? null)).toEqual([null, 'bronze', 'silver', 'silver', 'gold', 'gold']);
  });
});
