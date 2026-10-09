export type ListKind = 'followers' | 'following';

export interface UserRecord {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string;
  followersCount?: number;
  followingCount?: number;
  isProtected?: boolean;
  isVerified?: boolean;
  /** Present on Following entries: this user follows the owner. */
  followsYou?: boolean;
  /** Present on Followers entries: the owner follows this user. */
  youFollow?: boolean;
}

export interface ParsedPage {
  users: UserRecord[];
  /** Bottom pagination cursor, if the page carried one. */
  bottomCursor?: string;
  /** Top pagination cursor (used by X to fetch newer entries). */
  topCursor?: string;
  /** Entries that looked like users but could not be parsed. */
  warnings: number;
  /** Entries X reported as unavailable (suspended / deleted). */
  unavailable: number;
  /** Ids of the unavailable entries, when X's entry id carried one. */
  unavailableIds?: string[];
}

export type EventType =
  | 'NEW_FOLLOWER'
  | 'LOST_FOLLOWER'
  | 'NEW_FOLLOWING'
  | 'UNFOLLOWED_BY_ME'
  | 'LOST_MUTUAL'
  | 'NEW_MUTUAL'
  | 'RENAME';

export interface DiffEvent {
  type: EventType;
  userId: string;
  handle: string;
  /** Only for RENAME. */
  previousHandle?: string;
  /**
   * LOST_FOLLOWER: 'unfollowed' (default), 'likely_gone' (suspended / deactivated) or 'unconfirmed'
   * (missing from a list X kept short, and their profile could not be checked: X may be hiding them).
   * UNFOLLOWED_BY_ME: 'by_me' (seen you unfollow on x.com) or 'unknown' (other device, or the
   * account was suspended / deleted).
   */
  reason?: EventReason;
}

export type EventReason = 'unfollowed' | 'likely_gone' | 'unconfirmed' | 'by_me' | 'unknown';

export interface MemberRow {
  userId: string;
  handle: string;
  followsYou?: boolean;
  /**
   * Missing from the last committed scan. X's lists sometimes skip people, so a departure is only
   * reported when the next scan misses them too.
   */
  missing?: boolean;
  /**
   * Followers only: when a profile check last showed this missing member still follows you. X's
   * Followers list leaves some followers out on every load; they are not reported again until
   * this check goes stale.
   */
  checkedAt?: number;
}
