import type { ListKind } from '../types';

export type OperationName = 'Following' | 'Followers' | 'BlueVerifiedFollowers' | 'UserByScreenName';

const OPERATIONS = new Set<string>(['Following', 'Followers', 'BlueVerifiedFollowers', 'UserByScreenName']);
const GRAPHQL_RE = /\/i\/api\/graphql\/[^/]+\/([A-Za-z]+)/;

export interface OperationInfo {
  op: OperationName;
  userId?: string;
  screenName?: string;
  cursor?: string;
}

/** Identify a captured request. Returns null for anything we do not care about. */
export function parseOperationUrl(url: string): OperationInfo | null {
  let u: URL;
  try {
    u = new URL(url, 'https://x.com');
  } catch {
    return null;
  }
  const m = GRAPHQL_RE.exec(u.pathname);
  if (!m || !OPERATIONS.has(m[1])) return null;
  let vars: Record<string, unknown> = {};
  const raw = u.searchParams.get('variables');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') vars = parsed as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    op: m[1] as OperationName,
    userId: str(vars.userId),
    screenName: str(vars.screen_name),
    cursor: str(vars.cursor),
  };
}

export function opToKind(op: OperationName): ListKind | null {
  if (op === 'Following') return 'following';
  if (op === 'Followers') return 'followers';
  return null;
}

const UNFOLLOW_RE = /\/i\/api\/1\.1\/friendships\/destroy\.json/;

export const isUnfollowUrl = (url: string) => UNFOLLOW_RE.test(url);

/**
 * User id from a captured x.com unfollow (friendships/destroy.json): the request body carries
 * `user_id`, the response is the unfollowed user object.
 */
export function parseUnfollow(url: string, requestBody: string | undefined, responseBody: unknown): string | null {
  if (!isUnfollowUrl(url)) return null;
  const fromBody = requestBody ? new URLSearchParams(requestBody).get('user_id') : null;
  if (fromBody && /^\d+$/.test(fromBody)) return fromBody;
  const r = responseBody as { id_str?: unknown } | null;
  return r && typeof r.id_str === 'string' && /^\d+$/.test(r.id_str) ? r.id_str : null;
}
