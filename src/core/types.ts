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
   * LOST_FOLLOWER: 'unfollowed' (default) or 'likely_gone' (suspended / deactivated).
   * UNFOLLOWED_BY_ME: 'by_me' (seen you unfollow on x.com) or 'unknown' (other device, or the
   * account was suspended / deleted).
   */
  reason?: EventReason;
}

export type EventReason = 'unfollowed' | 'likely_gone' | 'by_me' | 'unknown';

export interface MemberRow {
  userId: string;
  handle: string;
  followsYou?: boolean;
}
