import { z } from 'zod';
import type { UserRecord } from '../types';

const minimalUser = z.object({
  id: z.string().regex(/^\d+$/),
  handle: z.string().min(1),
  name: z.string(),
});

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = <T>(guard: (v: unknown) => v is T, ...vals: unknown[]): T | undefined => vals.find(guard);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

const FOLLOWERS_KEYS = ['followers_count', 'normal_followers_count', 'follower_count', 'followers'];
const FOLLOWING_KEYS = ['friends_count', 'following_count', 'friends', 'following'];

/**
 * Find a numeric count by key name anywhere near the top of a user object. X keeps moving these
 * (legacy.followers_count -> other objects), so try the known names at any depth up to `maxDepth`.
 * Only numbers match: `following` / `followed_by` booleans are ignored.
 */
export function findCount(root: Obj, keys: string[], maxDepth = 4): number | undefined {
  for (const key of keys) {
    let level: Obj[] = [root];
    for (let depth = 0; depth <= maxDepth && level.length; depth++) {
      const next: Obj[] = [];
      for (const o of level) {
        if (isNum(o[key])) return o[key] as number;
        for (const child of Object.values(o)) if (isObj(child)) next.push(child);
      }
      level = next;
    }
  }
  return undefined;
}

/** Key paths of the numeric fields in an object (no values), to show where counts live in a response. */
export function numericPaths(root: unknown, maxDepth = 4, limit = 80): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (out.length >= limit || !isObj(node) || depth > maxDepth) return;
    for (const [key, value] of Object.entries(node)) {
      const p = path ? `${path}.${key}` : key;
      if (isNum(value)) out.push(p);
      else walk(value, p, depth + 1);
    }
  };
  walk(root, '', 0);
  return out;
}

export type UserParseResult =
  | { kind: 'ok'; user: UserRecord }
  | { kind: 'unavailable' }
  | { kind: 'invalid' };

/**
 * Extract a UserRecord from a `user_results.result` object. Field locations have moved between
 * X releases (legacy.* -> core.* / avatar.* / relationship_perspectives.*), so every known
 * location is tried.
 */
export function parseUserResult(result: unknown): UserParseResult {
  if (!isObj(result)) return { kind: 'invalid' };
  if (result.__typename === 'UserUnavailable') return { kind: 'unavailable' };
  // Wrapper used for some visibility results.
  const node = isObj(result.user) ? result.user : result;
  const legacy = isObj(node.legacy) ? node.legacy : {};
  const core = isObj(node.core) ? node.core : {};
  const avatar = isObj(node.avatar) ? node.avatar : {};
  const perspectives = isObj(node.relationship_perspectives) ? node.relationship_perspectives : {};
  const privacy = isObj(node.privacy) ? node.privacy : {};

  const candidate = {
    id: pick(isStr, node.rest_id),
    handle: pick(isStr, core.screen_name, legacy.screen_name),
    name: pick(isStr, core.name, legacy.name) ?? '',
  };
  const parsed = minimalUser.safeParse(candidate);
  if (!parsed.success) return { kind: 'invalid' };

  const user: UserRecord = {
    ...parsed.data,
    avatarUrl: pick(isStr, avatar.image_url, legacy.profile_image_url_https),
    followersCount: findCount(node, FOLLOWERS_KEYS),
    followingCount: findCount(node, FOLLOWING_KEYS),
    isProtected: pick(isBool, privacy.protected, legacy.protected),
    isVerified: pick(isBool, node.is_blue_verified, legacy.verified),
    followsYou: pick(isBool, perspectives.followed_by, legacy.followed_by),
    youFollow: pick(isBool, perspectives.following, legacy.following),
  };
  return { kind: 'ok', user };
}

export interface ProfileInfo {
  id: string;
  handle: string;
  followersCount?: number;
  followingCount?: number;
}

/** Parse a UserByScreenName response body. */
export function parseProfile(body: unknown): ProfileInfo | null {
  if (!isObj(body) || !isObj(body.data) || !isObj(body.data.user)) return null;
  const parsed = parseUserResult(body.data.user.result);
  if (parsed.kind !== 'ok') return null;
  return {
    id: parsed.user.id,
    handle: parsed.user.handle,
    followersCount: parsed.user.followersCount,
    followingCount: parsed.user.followingCount,
  };
}

/** The `result` object of a UserByScreenName body, if present. */
export function profileResult(body: unknown): unknown {
  if (!isObj(body) || !isObj(body.data) || !isObj(body.data.user)) return undefined;
  return body.data.user.result;
}
