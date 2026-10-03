import { browser } from 'wxt/browser';
import type { Repo } from '../db/repo';
import type { EventRow } from '../db/schema';
import { withoutRepeats } from '../core/follows';

export const seenKey = (ownerId: string) => `lastSeenEventId:${ownerId}`;

/** Events worth a badge: someone stopped following you. */
export const isDeparture = (e: EventRow) => e.type === 'LOST_FOLLOWER' || e.type === 'LOST_MUTUAL';

/** Departures newer than `seenId`, not counting one already reported by the other list. */
export const unseenDepartures = (history: EventRow[], seenId: number) =>
  withoutRepeats(history.filter((e) => (e.id ?? 0) > seenId && isDeparture(e)), history);

export function badgeText(count: number): string {
  return count <= 0 ? '' : count > 99 ? '99+' : String(count);
}

/** Toolbar badge = departures not yet seen in the popup. */
export async function refreshBadge(repo: Repo): Promise<void> {
  const ownerId = await repo.getSetting<string | undefined>('ownerId', undefined);
  let text = '';
  if (ownerId) {
    const seen = await repo.getSetting(seenKey(ownerId), 0);
    text = badgeText(unseenDepartures(await repo.allEvents(ownerId), seen).length);
  }
  await browser.action.setBadgeBackgroundColor({ color: '#d9534b' });
  await browser.action.setBadgeText({ text });
}
