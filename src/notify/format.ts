import type { EventRow } from '../db/schema';

export interface NotifyPrefs {
  browser: boolean;
  newFollowers: boolean;
  telegram?: { token: string; chatId: string };
  discord?: { url: string };
}

export const DEFAULT_PREFS: NotifyPrefs = { browser: true, newFollowers: false };

const NAME_LIMIT = 8;

function names(events: EventRow[]): string {
  const shown = events.slice(0, NAME_LIMIT).map((e) => `@${e.handle}`);
  const rest = events.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
}

/** One batched summary per committed scan; null when there is nothing worth telling. */
export function summarize(events: EventRow[], prefs: NotifyPrefs): { title: string; lines: string[] } | null {
  const by = (t: EventRow['type']) => events.filter((e) => e.type === t);
  const lost = by('LOST_FOLLOWER');
  const unfollowed = lost.filter((e) => e.reason !== 'likely_gone');
  const gone = lost.filter((e) => e.reason === 'likely_gone');
  const lostMutual = by('LOST_MUTUAL');
  const fresh = prefs.newFollowers ? by('NEW_FOLLOWER') : [];

  const lines: string[] = [];
  if (unfollowed.length) lines.push(`${unfollowed.length} unfollowed you: ${names(unfollowed)}`);
  if (gone.length) lines.push(`${gone.length} left (unfollowed or suspended/deleted): ${names(gone)}`);
  if (lostMutual.length) lines.push(`${lostMutual.length} you follow stopped following back: ${names(lostMutual)}`);
  if (fresh.length) lines.push(`${fresh.length} new follower${fresh.length === 1 ? '' : 's'}: ${names(fresh)}`);
  if (!lines.length) return null;
  return { title: 'Ghosted', lines };
}
