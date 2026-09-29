/** Synthetic GraphQL bodies shaped like X's Followers/Following responses. Replace with real captures (see docs/spike-notes.md). */
export interface FakeUser {
  id: string;
  handle: string;
  name?: string;
  followedBy?: boolean;
  following?: boolean;
}

export function userEntry(u: FakeUser, variant: 'legacy' | 'core' = 'legacy') {
  const flags = { followed_by: u.followedBy, following: u.following };
  const result =
    variant === 'legacy'
      ? {
          __typename: 'User',
          rest_id: u.id,
          is_blue_verified: false,
          legacy: {
            screen_name: u.handle,
            name: u.name ?? u.handle,
            followers_count: 10,
            friends_count: 5,
            protected: false,
            profile_image_url_https: `https://pbs.twimg.com/${u.id}.jpg`,
            ...flags,
          },
        }
      : {
          __typename: 'User',
          rest_id: u.id,
          is_blue_verified: true,
          core: { screen_name: u.handle, name: u.name ?? u.handle },
          avatar: { image_url: `https://pbs.twimg.com/${u.id}.jpg` },
          privacy: { protected: false },
          relationship_perspectives: { followed_by: u.followedBy, following: u.following },
          legacy: { followers_count: 10, friends_count: 5 },
        };
  return {
    entryId: `user-${u.id}`,
    sortIndex: u.id,
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: { itemType: 'TimelineUser', user_results: { result } },
    },
  };
}

export function cursorEntry(kind: 'top' | 'bottom', value: string) {
  return {
    entryId: `cursor-${kind}-${value}`,
    content: { entryType: 'TimelineTimelineCursor', cursorType: kind === 'top' ? 'Top' : 'Bottom', value },
  };
}

export function timelineBody(
  users: FakeUser[],
  bottomCursor: string | null,
  variant: 'legacy' | 'core' = 'legacy',
  extraEntries: unknown[] = [],
) {
  const entries: unknown[] = [...users.map((u) => userEntry(u, variant)), ...extraEntries];
  entries.push(cursorEntry('top', 'top1'));
  if (bottomCursor) entries.push(cursorEntry('bottom', bottomCursor));
  return {
    data: {
      user: {
        result: {
          __typename: 'User',
          timeline: { timeline: { instructions: [{ type: 'TimelineClearCache' }, { type: 'TimelineAddEntries', entries }] } },
        },
      },
    },
  };
}

export const mkUsers = (from: number, to: number, extra: Partial<FakeUser> = {}): FakeUser[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ id: String(from + i), handle: `user${from + i}`, ...extra }));
