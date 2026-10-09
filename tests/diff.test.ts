import { describe, expect, it } from 'vitest';
import { RECHECK_MS, diffScan } from '../src/core/diff';
import type { MemberRow, UserRecord } from '../src/core/types';

const u = (id: string, handle = `h${id}`, extra: Partial<UserRecord> = {}): UserRecord => ({ id, handle, name: handle, ...extra });
const m = (userId: string, followsYou?: boolean, handle = `h${userId}`): MemberRow => ({ userId, handle, followsYou });
/** A member the previous scan already missed: a second miss reports them. */
const missed = (userId: string, followsYou?: boolean): MemberRow => ({ ...m(userId, followsYou), missing: true });
const empty = new Map<string, string>();
const types = (r: ReturnType<typeof diffScan>) => r.events.map((e) => `${e.type}:${e.userId}`).sort();

describe('diffScan followers', () => {
  it('emits new and lost followers', () => {
    const r = diffScan({ kind: 'followers', prev: [missed('1'), m('2')], next: [u('2'), u('3')], knownHandles: empty, isBaseline: false });
    expect(types(r)).toEqual(['LOST_FOLLOWER:1', 'NEW_FOLLOWER:3']);
    expect(r.removed).toBe(1);
    expect(r.members.map((x) => x.userId)).toEqual(['2', '3']);
  });
  it('holds a first miss as missing instead of reporting it', () => {
    const r = diffScan({ kind: 'followers', prev: [m('1'), m('2')], next: [u('2')], knownHandles: empty, isBaseline: false });
    expect(r.events).toEqual([]);
    expect(r.removed).toBe(1);
    expect(r.members).toEqual([{ userId: '2', handle: 'h2' }, { userId: '1', handle: 'h1', followsYou: undefined, missing: true }]);
  });
  it('someone missed once and back again is no event and no longer missing', () => {
    const r = diffScan({ kind: 'followers', prev: [missed('1')], next: [u('1')], knownHandles: empty, isBaseline: false });
    expect(r.events).toEqual([]);
    expect(r.members).toEqual([{ userId: '1', handle: 'h1' }]);
  });
  it('reports a first miss at once when confirmNow is set', () => {
    const r = diffScan({ kind: 'followers', prev: [m('1')], next: [], knownHandles: empty, isBaseline: false, confirmNow: true });
    expect(types(r)).toEqual(['LOST_FOLLOWER:1']);
    expect(r.members).toEqual([]);
  });
  it('a stranger in the next scan is a new follower at most, never an unfollower', () => {
    const r = diffScan({ kind: 'followers', prev: [m('1'), m('2')], next: [u('3')], knownHandles: empty, isBaseline: false });
    expect(types(r)).toEqual(['NEW_FOLLOWER:3']);
    expect(r.removed).toBe(2);
    // The two previous members are held for the next scan, not reported as departures.
    expect(r.members.filter((x) => x.missing).map((x) => x.userId).sort()).toEqual(['1', '2']);
  });
  it('never reports someone X listed as unavailable, and keeps them as a member', () => {
    const r = diffScan({
      kind: 'followers',
      prev: [m('1'), missed('2')],
      next: [],
      knownHandles: empty,
      isBaseline: false,
      unavailable: new Set(['1', '2']),
    });
    expect(r.events).toEqual([]);
    expect(r.removed).toBe(0);
    expect(r.members).toEqual([{ userId: '1', handle: 'h1', followsYou: undefined }, { userId: '2', handle: 'h2', followsYou: undefined }]);
  });
  it('baseline sets membership without events', () => {
    const r = diffScan({ kind: 'followers', prev: [], next: [u('1'), u('2')], knownHandles: empty, isBaseline: true });
    expect(r.events).toEqual([]);
    expect(r.members).toHaveLength(2);
  });
  it('a rename is a RENAME, not an unfollow', () => {
    const r = diffScan({
      kind: 'followers',
      prev: [m('1')],
      next: [u('1', 'newname')],
      knownHandles: new Map([['1', 'h1']]),
      isBaseline: false,
    });
    expect(r.events).toEqual([{ type: 'RENAME', userId: '1', handle: 'newname', previousHandle: 'h1' }]);
  });
  it('handle case change is not a rename', () => {
    const r = diffScan({ kind: 'followers', prev: [m('1')], next: [u('1', 'H1')], knownHandles: new Map([['1', 'h1']]), isBaseline: false });
    expect(r.events).toEqual([]);
  });
  it('marks likely_gone from the hint', () => {
    const r = diffScan({ kind: 'followers', prev: [missed('1'), missed('2')], next: [], knownHandles: empty, isBaseline: false, goneHint: new Set(['2']) });
    expect(r.events.find((e) => e.userId === '2')?.reason).toBe('likely_gone');
    expect(r.events.find((e) => e.userId === '1')?.reason).toBe('unfollowed');
  });
  it('still reports renames on a baseline scan', () => {
    const r = diffScan({ kind: 'followers', prev: [], next: [u('1', 'new')], knownHandles: new Map([['1', 'old']]), isBaseline: true });
    expect(r.events.map((e) => e.type)).toEqual(['RENAME']);
  });
});

describe('diffScan following', () => {
  it('emits following changes and mutual flips', () => {
    const r = diffScan({
      kind: 'following',
      prev: [m('1', true), m('2', false), missed('3', true)],
      next: [u('1', 'h1', { followsYou: false }), u('2', 'h2', { followsYou: true }), u('4', 'h4', { followsYou: false })],
      knownHandles: empty,
      isBaseline: false,
    });
    expect(types(r)).toEqual(['LOST_MUTUAL:1', 'NEW_FOLLOWING:4', 'NEW_MUTUAL:2', 'UNFOLLOWED_BY_ME:3']);
  });
  it('ignores flips when the flag is unknown on either side', () => {
    const r = diffScan({ kind: 'following', prev: [m('1', undefined)], next: [u('1', 'h1', { followsYou: false })], knownHandles: empty, isBaseline: false });
    expect(r.events).toEqual([]);
  });
  it('stores followsYou on members', () => {
    const r = diffScan({ kind: 'following', prev: [], next: [u('1', 'h1', { followsYou: true })], knownHandles: empty, isBaseline: true });
    expect(r.members[0].followsYou).toBe(true);
  });
});

describe('diffScan: why someone left your following', () => {
  it('reports an observed unfollow at once, holds an unexplained first miss', () => {
    const r = diffScan({ kind: 'following', prev: [m('1'), m('2')], next: [], knownHandles: empty, isBaseline: false, myUnfollows: new Set(['1']) });
    expect(types(r)).toEqual(['UNFOLLOWED_BY_ME:1']);
    expect(r.members.map((x) => [x.userId, x.missing])).toEqual([['2', true]]);
  });
  it('uses the observed-unfollow set', () => {
    const r = diffScan({ kind: 'following', prev: [m('1'), missed('2')], next: [], knownHandles: empty, isBaseline: false, myUnfollows: new Set(['1']) });
    expect(r.events.find((e) => e.userId === '1')?.reason).toBe('by_me');
    expect(r.events.find((e) => e.userId === '2')?.reason).toBe('unknown');
  });
});

describe('diffScan: followers X hides from the list', () => {
  const base = { kind: 'followers' as const, knownHandles: empty, isBaseline: false, now: RECHECK_MS * 10 };
  it('holds a second miss for a profile check when verify is on', () => {
    const r = diffScan({ ...base, prev: [missed('1'), m('2')], next: [u('2')], verify: true });
    expect(r.events).toEqual([]);
    expect(r.toVerify.map((x) => x.userId)).toEqual(['1']);
    expect(r.members.find((x) => x.userId === '1')).toMatchObject({ missing: true });
  });
  it('keeps a recently checked follower silently, checks one again once the check is stale', () => {
    const fresh = { ...missed('1'), checkedAt: base.now - 1000 };
    const r = diffScan({ ...base, prev: [fresh], next: [], verify: true });
    expect(r.events).toEqual([]);
    expect(r.toVerify).toEqual([]);
    expect(r.members).toEqual([fresh]);
    // Without verify (a manual check) too: their profile said they follow you.
    expect(diffScan({ ...base, prev: [fresh], next: [] }).events).toEqual([]);
    const stale = { ...missed('1'), checkedAt: base.now - RECHECK_MS - 1 };
    expect(diffScan({ ...base, prev: [stale], next: [], verify: true }).toVerify.map((x) => x.userId)).toEqual(['1']);
  });
  it('without a check, a departure from a short list is unconfirmed, from a full one unfollowed', () => {
    expect(diffScan({ ...base, prev: [missed('1')], next: [], short: true }).events[0].reason).toBe('unconfirmed');
    expect(diffScan({ ...base, prev: [missed('1')], next: [], short: false }).events[0].reason).toBe('unfollowed');
  });
  it('a likely suspended follower is reported, not checked', () => {
    const r = diffScan({ ...base, prev: [missed('1')], next: [], verify: true, goneHint: new Set(['1']) });
    expect(r.events[0]).toMatchObject({ type: 'LOST_FOLLOWER', reason: 'likely_gone' });
    expect(r.toVerify).toEqual([]);
  });
  it('someone hidden by X who shows up again loses the check mark', () => {
    const r = diffScan({ ...base, prev: [{ ...missed('1'), checkedAt: base.now }], next: [u('1')], verify: true });
    expect(r.members).toEqual([{ userId: '1', handle: 'h1' }]);
  });
});
