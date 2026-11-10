import type { Repo } from './repo';

export interface DiagnosticsMeta {
  version: string;
  userAgent: string;
}

const minutesAgo = (ts: number | undefined, now: number) => (ts ? Math.round((now - ts) / 60_000) : null);

/** Rate-limit counters with the reset shown as minutes from now (negative: already reset). */
const rateHeaders = (h: { limit?: number; remaining?: number; reset?: number } | null | undefined, now: number) =>
  h
    ? {
        limit: h.limit ?? null,
        remaining: h.remaining ?? null,
        resetInMinutes: typeof h.reset === 'number' ? Math.round((h.reset * 1000 - now) / 60_000) : null,
      }
    : null;

/**
 * A short technical snapshot for bug reports. Deliberately contains no handles, names or ids:
 * only counts, statuses and ages.
 */
export async function buildDiagnostics(repo: Repo, ownerId: string | undefined, meta: DiagnosticsMeta, now = Date.now()) {
  const health = await repo.getSetting<Record<string, any>>('health', {});
  const profile = ownerId
    ? await repo.getSetting<{ followersCount?: number; followingCount?: number; at?: number } | null>(`profile:${ownerId}`, null)
    : null;
  const scans = ownerId ? (await repo.listScans(ownerId, 6)) : [];
  const members = ownerId
    ? { followers: (await repo.listMembers(ownerId, 'followers')).length, following: (await repo.listMembers(ownerId, 'following')).length }
    : null;
  return {
    app: 'Ghosted',
    version: meta.version,
    browser: meta.userAgent,
    threshold: await repo.getSetting('threshold', null),
    health: {
      lastCaptureMinutesAgo: minutesAgo(health.lastCaptureAt, now),
      lastRateLimitMinutesAgo: minutesAgo(health.lastRateLimitAt, now),
      // What X answered and how far the scan got: tells a real limit from a broken response.
      lastRateLimit: health.lastRateLimit
        ? {
            minutesAgo: minutesAgo(health.lastRateLimit.at, now),
            kind: health.lastRateLimit.kind ?? null,
            status: health.lastRateLimit.status ?? null,
            message: health.lastRateLimit.message ?? null,
            collected: health.lastRateLimit.collected ?? null,
            pages: health.lastRateLimit.pages ?? null,
            // X's own counters on the failing response: window size, what was left, when it resets.
            headers: rateHeaders(health.lastRateLimit.headers, now),
            // Whether the check waited for the reset (minutes from now; negative: already over) or gave up.
            resumeInMinutes: typeof health.lastRateLimit.resumeAt === 'number' ? Math.round((health.lastRateLimit.resumeAt - now) / 60_000) : null,
          }
        : null,
      // The same counters on the latest list page that loaded fine: how fast a check drains them.
      lastListHeaders: health.lastListHeaders
        ? {
            kind: health.lastListHeaders.kind ?? null,
            minutesAgo: minutesAgo(health.lastListHeaders.at, now),
            ...rateHeaders(health.lastListHeaders, now),
          }
        : null,
      // Where X keeps numeric fields in the profile response, shown only when counts were not found.
      profileShape: health.profileShape ?? null,
      lastParseError: health.lastParseError
        ? { minutesAgo: minutesAgo(health.lastParseError.at, now), op: health.lastParseError.op, status: health.lastParseError.status }
        : null,
    },
    profileCount: profile
      ? { followers: profile.followersCount ?? null, following: profile.followingCount ?? null, minutesAgo: minutesAgo(profile.at, now) }
      : null,
    saved: members,
    latestScans: scans.map((s) => ({
      kind: s.kind,
      status: s.status,
      minutesAgo: minutesAgo(s.startedAt, now),
      collected: s.collected,
      xCount: s.expected ?? null,
      unavailable: s.state?.unavailable ?? 0,
      pages: s.state?.pages ?? 0,
      reason: s.reason ?? null,
      pendingRemoved: s.pendingRemoved ?? null,
    })),
  };
}
