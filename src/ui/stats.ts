import type { ListKind, MemberRow } from '../core/types';
import type { EventRow, ScanRow } from '../db/schema';
import { distinctChanges, followChange, type FollowChange } from '../core/follows';

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

export interface ListGap {
  /** The follower/following count X itself showed when the scan ran. */
  xCount: number;
  /** How many accounts X counts beyond the ones it listed. */
  gap: number;
}

/**
 * X's counter is usually a little higher than the list it serves (suspended / deactivated accounts).
 * Returns the difference for the latest committed scan, or null when unknown or too small to mention.
 */
export function listGap(scan: Pick<ScanRow, 'collected' | 'expected'> | undefined, minGap = 3): ListGap | null {
  if (!scan?.expected) return null;
  const gap = scan.expected - scan.collected;
  return gap >= minGap ? { xCount: scan.expected, gap } : null;
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

export interface FollowerChange {
  at: number;
  kind: FollowChange;
  userId: string;
}

/** Follower gains and losses, each counted once although both lists can report it (see `distinctChanges`). */
export function followerChanges(events: EventRow[]): FollowerChange[] {
  return distinctChanges(events).map((e) => ({ at: e.at, kind: followChange(e.type)!, userId: e.userId }));
}

/** Followers gained / lost per local day, for the last `days` days including today. */
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
