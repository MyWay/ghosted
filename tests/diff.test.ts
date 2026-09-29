import { describe, expect, it } from 'vitest';
import { diffScan } from '../src/core/diff';
import type { MemberRow, UserRecord } from '../src/core/types';

const u = (id: string, handle = `h${id}`, extra: Partial<UserRecord> = {}): UserRecord => ({ id, handle, name: handle, ...extra });
const m = (userId: string, followsYou?: boolean, handle = `h${userId}`): MemberRow => ({ userId, handle, followsYou });
const empty = new Map<string, string>();
const types = (r: ReturnType<typeof diffScan>) => r.events.map((e) => `${e.type}:${e.userId}`).sort();

describe('diffScan followers', () => {
  it('emits new and lost followers', () => {
    const r = diffScan({ kind: 'followers', prev: [m('1'), m('2')], next: [u('2'), u('3')], knownHandles: empty, isBaseline: false });
    expect(types(r)).toEqual(['LOST_FOLLOWER:1', 'NEW_FOLLOWER:3']);
    expect(r.removed).toBe(1);
    expect(r.members.map((x) => x.userId)).toEqual(['2', '3']);
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
    const r = diffScan({ kind: 'followers', prev: [m('1'), m('2')], next: [], knownHandles: empty, isBaseline: false, goneHint: new Set(['2']) });
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
      prev: [m('1', true), m('2', false), m('3', true)],
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
  it('uses the observed-unfollow set', () => {
    const r = diffScan({ kind: 'following', prev: [m('1'), m('2')], next: [], knownHandles: empty, isBaseline: false, myUnfollows: new Set(['1']) });
    expect(r.events.find((e) => e.userId === '1')?.reason).toBe('by_me');
    expect(r.events.find((e) => e.userId === '2')?.reason).toBe('unknown');
  });
});
