import type { ListKind, MemberRow } from '../core/types';
import type { EventRow, ScanRow } from '../db/schema';

export interface Totals {
  followers: number;
  following: number;
  mutuals: number;
  notFollowingBack: number;
  fans: number;
}

export function totals(following: MemberRow[], followers: MemberRow[]): Totals {
  const followingIds = new Set(following.map((m) => m.userId));
  return {
    followers: followers.length,
    following: following.length,
    mutuals: following.filter((m) => m.followsYou === true).length,
    notFollowingBack: following.filter((m) => m.followsYou === false).length,
    fans: followers.filter((m) => !followingIds.has(m.userId)).length,
  };
}

export interface Point {
  t: number;
  v: number;
}

/** List size after each committed scan, oldest first. */
export function countSeries(scans: ScanRow[], kind: ListKind): Point[] {
  return scans
    .filter((s) => s.kind === kind && s.status === 'committed' && s.endedAt)
    .map((s) => ({ t: s.endedAt!, v: s.collected }))
    .sort((a, b) => a.t - b.t);
}

/** Change of the latest value versus the last point at or before `now - windowMs`. */
export function delta(series: Point[], windowMs: number, now: number): number | undefined {
  if (series.length < 2) return undefined;
  const cutoff = now - windowMs;
  const before = [...series].reverse().find((p) => p.t <= cutoff) ?? series[0];
  const last = series[series.length - 1];
  return before === last ? undefined : last.v - before.v;
}

export interface DayChange {
  /** Local midnight of the day. */
  day: number;
  gained: number;
  lost: number;
}

const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Followers gained / lost per local day, for the last `days` days including today. */
/** The same departure can be reported by both lists (following scan: LOST_MUTUAL, followers scan: LOST_FOLLOWER). */
const DUPLICATE_WINDOW_MS = 3 * 86_400_000;

export interface FollowerChange {
  at: number;
  kind: 'gain' | 'loss';
  userId: string;
}

/**
 * Follower gains and losses, with duplicates removed. "Followed you back" (NEW_MUTUAL) is a gain and
 * "stopped following you back" (LOST_MUTUAL) is a loss, because someone you follow who stops or starts
 * following you changes your follower count too. The follower scan later reports the same person again,
 * so a second event of the same kind for the same user within 3 days is ignored.
 */
export function followerChanges(events: EventRow[]): FollowerChange[] {
  const kindOf = (t: EventRow['type']) =>
    t === 'NEW_FOLLOWER' || t === 'NEW_MUTUAL' ? 'gain' : t === 'LOST_FOLLOWER' || t === 'LOST_MUTUAL' ? 'loss' : null;
  const last = new Map<string, number>();
  const out: FollowerChange[] = [];
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const kind = kindOf(e.type);
    if (!kind) continue;
    const key = `${kind}:${e.userId}`;
    const prev = last.get(key);
    if (prev !== undefined && e.at - prev < DUPLICATE_WINDOW_MS) continue;
    last.set(key, e.at);
    out.push({ at: e.at, kind, userId: e.userId });
  }
  return out;
}

export function dailyChanges(events: EventRow[], days: number, now: number): DayChange[] {
  const today = startOfDay(now);
  const out: DayChange[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push({ day: d.getTime(), gained: 0, lost: 0 });
  }
  const index = new Map(out.map((d, i) => [d.day, i]));
  for (const c of followerChanges(events)) {
    const i = index.get(startOfDay(c.at));
    if (i === undefined) continue;
    if (c.kind === 'gain') out[i].gained++;
    else out[i].lost++;
  }
  return out;
}

/** 3-6 round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, target = 4, integer = false): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  if (integer) step = Math.max(1, step === 2.5 * mag ? 5 * mag : Math.round(step));
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export const compact = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);

export const signed = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `−${Math.abs(n).toLocaleString()}` : '±0');
