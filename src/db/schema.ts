import Dexie, { type Table } from 'dexie';
import type { SessionState } from '../core/session';
import type { EventReason, EventType, ListKind, UserRecord } from '../core/types';

export type ScanStatus = 'collecting' | 'complete' | 'abandoned' | 'invalid' | 'needs_review' | 'committed' | 'rejected';

export interface UserRow {
  ownerId: string;
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string;
  followersCount?: number;
  followingCount?: number;
  isProtected?: boolean;
  isVerified?: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  handleHistory: string[];
}

export interface ScanRow {
  scanId?: number;
  ownerId: string;
  kind: ListKind;
  startedAt: number;
  endedAt?: number;
  status: ScanStatus;
  reason?: string;
  state: SessionState;
  expected?: number;
  collected: number;
  /** Removals that triggered a needs_review hold. */
  pendingRemoved?: number;
  source: 'graphql' | 'dom';
}

export interface ScanItemRow {
  scanId: number;
  userId: string;
  user: UserRecord;
}

export interface MembershipRow {
  ownerId: string;
  kind: ListKind;
  userId: string;
  handle: string;
  followsYou?: boolean;
  missing?: boolean;
  checkedAt?: number;
}

export interface EventRow {
  id?: number;
  ownerId: string;
  scanId: number;
  at: number;
  type: EventType;
  userId: string;
  handle: string;
  previousHandle?: string;
  reason?: EventReason;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export const DB_NAME = 'ghosted';
/** Database name used before the rename; migrated once by `migrateLegacyDb`. */
export const LEGACY_DB_NAME = 'x-unfollowers';

export class AppDB extends Dexie {
  users!: Table<UserRow, [string, string]>;
  scans!: Table<ScanRow, number>;
  scanItems!: Table<ScanItemRow, [number, string]>;
  membership!: Table<MembershipRow, [string, string, string]>;
  events!: Table<EventRow, number>;
  settings!: Table<SettingRow, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      users: '[ownerId+id], ownerId, handle, lastSeenAt',
      scans: '++scanId, [ownerId+kind], startedAt, status',
      scanItems: '[scanId+userId], scanId',
      membership: '[ownerId+kind+userId], [ownerId+kind]',
      events: '++id, [ownerId+at], [ownerId+type], userId, scanId',
      settings: 'key',
    });
  }
}
