import { describe, expect, it } from 'vitest';
import { opToKind, parseOperationUrl } from '../src/core/parse/operations';
import { parseTimelinePage } from '../src/core/parse/timeline';
import { parseProfile } from '../src/core/parse/user';
import { cursorEntry, mkUsers, timelineBody } from './helpers';

describe('parseOperationUrl', () => {
  const vars = encodeURIComponent(JSON.stringify({ userId: '42', count: 50, cursor: 'abc|1' }));
  it('extracts op, user and cursor', () => {
    const info = parseOperationUrl(`https://x.com/i/api/graphql/QID123/Followers?variables=${vars}&features=%7B%7D`);
    expect(info).toEqual({ op: 'Followers', userId: '42', screenName: undefined, cursor: 'abc|1' });
    expect(opToKind(info!.op)).toBe('followers');
  });
  it('has no cursor on the first page', () => {
    const v = encodeURIComponent(JSON.stringify({ userId: '42' }));
    expect(parseOperationUrl(`/i/api/graphql/Q/Following?variables=${v}`)?.cursor).toBeUndefined();
  });
  it('ignores unrelated operations and bad URLs', () => {
    expect(parseOperationUrl('https://x.com/i/api/graphql/Q/HomeTimeline?variables={}')).toBeNull();
    expect(parseOperationUrl('https://x.com/other')).toBeNull();
  });
  it('survives malformed variables', () => {
    expect(parseOperationUrl('https://x.com/i/api/graphql/Q/Followers?variables=%7Bbroken')?.userId).toBeUndefined();
  });
});

describe('parseTimelinePage', () => {
  it('parses legacy-shaped users and the bottom cursor', () => {
    const page = parseTimelinePage(timelineBody(mkUsers(1, 3, { followedBy: true }), 'next|1'))!;
    expect(page.users.map((u) => u.id)).toEqual(['1', '2', '3']);
    expect(page.users[0]).toMatchObject({ handle: 'user1', followsYou: true, isVerified: false });
    expect(page.bottomCursor).toBe('next|1');
    expect(page.warnings).toBe(0);
  });
  it('parses core/avatar/relationship_perspectives shape', () => {
    const page = parseTimelinePage(timelineBody(mkUsers(1, 2, { followedBy: false, following: true }), null, 'core'))!;
    expect(page.users[1]).toMatchObject({ handle: 'user2', followsYou: false, youFollow: true, isVerified: true });
    expect(page.users[0].avatarUrl).toContain('pbs.twimg.com');
    expect(page.bottomCursor).toBeUndefined();
  });
  it('dedupes users within a page', () => {
    const page = parseTimelinePage(timelineBody([...mkUsers(1, 2), ...mkUsers(2, 3)], 'c'))!;
    expect(page.users.map((u) => u.id)).toEqual(['1', '2', '3']);
  });
  it('counts unavailable users and unparseable entries separately', () => {
    const bad = { entryId: 'user-9', content: { itemContent: { user_results: { result: { __typename: 'User' } } } } };
    const gone = {
      entryId: 'user-8',
      content: { itemContent: { user_results: { result: { __typename: 'UserUnavailable' } } } },
    };
    const page = parseTimelinePage(timelineBody(mkUsers(1, 1), 'c', 'legacy', [bad, gone]))!;
    expect(page.users).toHaveLength(1);
    expect(page.warnings).toBe(1);
    expect(page.unavailable).toBe(1);
  });
  it('reads a cursor delivered via TimelineReplaceEntry', () => {
    const body = timelineBody(mkUsers(1, 1), null);
    (body.data.user.result.timeline.timeline.instructions as unknown[]).push({
      type: 'TimelineReplaceEntry',
      entry: cursorEntry('bottom', 'replaced|1'),
    });
    expect(parseTimelinePage(body)!.bottomCursor).toBe('replaced|1');
  });
  it('returns null for bodies without a timeline', () => {
    expect(parseTimelinePage({ errors: [{ message: 'Rate limit exceeded' }] })).toBeNull();
    expect(parseTimelinePage(null)).toBeNull();
  });
});

describe('parseProfile', () => {
  it('extracts id and counts', () => {
    const body = {
      data: { user: { result: { __typename: 'User', rest_id: '7', legacy: { screen_name: 'me', name: 'Me', followers_count: 120, friends_count: 80 } } } },
    };
    expect(parseProfile(body)).toEqual({ id: '7', handle: 'me', followersCount: 120, followingCount: 80 });
  });
  it('returns null on garbage', () => {
    expect(parseProfile({ data: {} })).toBeNull();
  });
});

import { isUnfollowUrl, parseUnfollow } from '../src/core/parse/operations';
import { parseApiErrors } from '../src/core/parse/timeline';

describe('top cursor and API errors', () => {
  it('parses the top cursor', () => {
    expect(parseTimelinePage(timelineBody(mkUsers(1, 1), 'b'))!.topCursor).toBe('top1');
  });
  it('recognises a 200 rate-limit error body', () => {
    expect(parseApiErrors({ errors: [{ code: 88, message: 'Rate limit exceeded' }] })).toEqual({ message: 'Rate limit exceeded', rateLimited: true });
    expect(parseApiErrors({ errors: [{ message: 'Something broke' }] })?.rateLimited).toBe(false);
    expect(parseApiErrors({ data: {} })).toBeNull();
  });
});

describe('parseUnfollow', () => {
  const url = 'https://x.com/i/api/1.1/friendships/destroy.json';
  it('reads user_id from the request body, else id_str from the response', () => {
    expect(isUnfollowUrl(url)).toBe(true);
    expect(parseUnfollow(url, 'include_profile_interstitial_type=1&user_id=12345', null)).toBe('12345');
    expect(parseUnfollow(url, undefined, { id_str: '777' })).toBe('777');
    expect(parseUnfollow(url, 'user_id=abc', {})).toBeNull();
    expect(parseUnfollow('https://x.com/i/api/1.1/friendships/create.json', 'user_id=1', null)).toBeNull();
  });
});

import { findCount, numericPaths } from '../src/core/parse/user';

describe('follower counts wherever X puts them', () => {
  const profile = (result: Record<string, unknown>) => ({
    data: { user: { result: { __typename: 'User', rest_id: '7', core: { screen_name: 'me', name: 'Me' }, ...result } } },
  });

  it('reads the classic legacy location', () => {
    expect(parseProfile(profile({ legacy: { followers_count: 702, friends_count: 610 } }))).toMatchObject({ followersCount: 702, followingCount: 610 });
  });
  it('reads counts from other objects X has used', () => {
    expect(parseProfile(profile({ relationship_counts: { followers: 702, following: 610 } }))).toMatchObject({ followersCount: 702, followingCount: 610 });
    expect(parseProfile(profile({ public_metrics: { followers_count: 702, following_count: 610 } }))).toMatchObject({ followersCount: 702, followingCount: 610 });
    expect(parseProfile(profile({ stats: { deep: { followers_count: 702, friends_count: 610 } } }))).toMatchObject({ followersCount: 702, followingCount: 610 });
  });
  it('is not fooled by boolean relationship flags called "following"', () => {
    const p = parseProfile(profile({ relationship_perspectives: { following: true, followed_by: false }, legacy: { followers_count: 5, friends_count: 9 } }));
    expect(p).toMatchObject({ followersCount: 5, followingCount: 9 });
    expect(findCount({ relationship_perspectives: { following: true } }, ['following'])).toBeUndefined();
  });
  it('leaves counts undefined when they are nowhere to be found', () => {
    expect(parseProfile(profile({ legacy: { statuses_count: 12 } }))).toMatchObject({ followersCount: undefined, followingCount: undefined });
  });
  it('describes where numeric fields live without exposing values', () => {
    const paths = numericPaths({ legacy: { statuses_count: 12345, nested: { likes: 9 } }, id: 3, name: 'x' });
    expect(paths).toEqual(['legacy.statuses_count', 'legacy.nested.likes', 'id']);
    expect(JSON.stringify(paths)).not.toMatch(/12345/);
  });
});
