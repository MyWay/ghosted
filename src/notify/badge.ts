import { browser } from 'wxt/browser';
import type { Repo } from '../db/repo';
import type { EventRow } from '../db/schema';

export const seenKey = (ownerId: string) => `lastSeenEventId:${ownerId}`;

/** Events worth a badge: someone stopped following you. */
export const isDeparture = (e: EventRow) => e.type === 'LOST_FOLLOWER' || e.type === 'LOST_MUTUAL';

export function badgeText(count: number): string {
  return count <= 0 ? '' : count > 99 ? '99+' : String(count);
}

/** Toolbar badge = departures not yet seen in the popup. */
export async function refreshBadge(repo: Repo): Promise<void> {
  const ownerId = await repo.getSetting<string | undefined>('ownerId', undefined);
  let text = '';
  if (ownerId) {
    const seen = await repo.getSetting(seenKey(ownerId), 0);
    const unseen = await repo.recentEvents(ownerId, 500, seen);
    text = badgeText(unseen.filter(isDeparture).length);
  }
  await browser.action.setBadgeBackgroundColor({ color: '#d9534b' });
  await browser.action.setBadgeText({ text });
}
