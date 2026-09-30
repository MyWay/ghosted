import type { Repo } from './repo';

export interface DiagnosticsMeta {
  version: string;
  userAgent: string;
}

const minutesAgo = (ts: number | undefined, now: number) => (ts ? Math.round((now - ts) / 60_000) : null);

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
