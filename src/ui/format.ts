import type { EventRow } from '../db/schema';

export function timeAgo(ts: number | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function eventLabel(e: EventRow): string {
  switch (e.type) {
    case 'NEW_FOLLOWER':
      return 'followed you';
    case 'LOST_FOLLOWER':
      return e.reason === 'likely_gone' ? 'left (unfollowed, or suspended/deleted)' : 'unfollowed you';
    case 'NEW_FOLLOWING':
      return 'you followed';
    case 'UNFOLLOWED_BY_ME':
      return e.reason === 'by_me' ? 'you unfollowed' : 'left your following (unfollowed elsewhere, or suspended/deleted)';
    case 'LOST_MUTUAL':
      return 'stopped following you back';
    case 'NEW_MUTUAL':
      return 'followed you back';
    case 'RENAME':
      return `renamed from @${e.previousHandle}`;
  }
}

export const eventTone = (e: EventRow): 'bad' | 'good' | 'neutral' =>
  e.type === 'LOST_FOLLOWER' || e.type === 'LOST_MUTUAL' ? 'bad' : e.type === 'NEW_FOLLOWER' || e.type === 'NEW_MUTUAL' ? 'good' : 'neutral';

export const profileUrl = (handle: string) => `https://x.com/${handle}`;

export function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\n');
}

export function download(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
