import type { ListKind } from './types';

/**
 * A list whose last committed scan is younger than this is not re-read by a full check. X limits
 * how much one session may read (a full following+followers check on a few thousand accounts
 * exceeds it and always dies near the end of the second list), so a check spends its budget on
 * the lists that are actually stale. Long enough that daily checks alternate the two lists.
 */
export const SKIP_FRESH_MS = 36 * 60 * 60 * 1000;

/**
 * Combined size (accounts in both lists) up to which one check still reads two stale lists. Above
 * it a check reads only the stalest list: reading both would let the second die at X's limit every
 * time, and with infrequent checks that list would never commit.
 */
export const BOTH_LISTS_MAX = 1_500;

/** Followers first: the unfollower answer lands even when a later list is cut short. */
const ORDER: ListKind[] = ['followers', 'following'];

export interface LastCommits {
  followers?: number;
  following?: number;
}

export interface ListSizes {
  followers?: number;
  following?: number;
}

/** A list a full check left out, and why: shown on the check's panel so it does not look skipped by mistake. */
export interface SkippedList {
  kind: ListKind;
  /** `fresh`: checked recently. `budget`: left for the next check to stay under X's read limit. */
  reason: 'fresh' | 'budget';
  /** When its last check finished, if it ever did. */
  checkedAt?: number;
}

export interface CheckPlan {
  kinds: ListKind[];
  skipped: SkippedList[];
}

/** Oldest commit first; a list never committed is the stalest; a tie goes to followers (ORDER). */
const stalest = (kinds: ListKind[], lastCommitAt: LastCommits): ListKind =>
  kinds.reduce((a, b) => ((lastCommitAt[a] ?? -Infinity) <= (lastCommitAt[b] ?? -Infinity) ? a : b));

/**
 * Which lists a requested check should actually read, in order. A multi-list request drops lists
 * with a fresh committed scan. When several are stale, a big account reads only the stalest, so
 * every list gets its turn; a small one (or one whose size is unknown) reads them all. When
 * everything is fresh, the stalest list runs alone so a check always makes progress. A single-list
 * request is explicit and runs exactly that list.
 */
export function planKinds(requested: ListKind[], lastCommitAt: LastCommits, now: number, sizes: ListSizes = {}): ListKind[] {
  const known = requested.filter((k) => ORDER.includes(k));
  if (known.length < 2) return known;
  return pick(known, lastCommitAt, now, sizes);
}

/** `planKinds`, plus the requested lists it left out and why. */
export function planCheck(requested: ListKind[], lastCommitAt: LastCommits, now: number, sizes: ListSizes = {}): CheckPlan {
  const kinds = planKinds(requested, lastCommitAt, now, sizes);
  const skipped = ORDER.filter((k) => requested.includes(k) && !kinds.includes(k)).map((kind): SkippedList => {
    const checkedAt = lastCommitAt[kind];
    const fresh = checkedAt !== undefined && now - checkedAt < SKIP_FRESH_MS;
    return { kind, reason: fresh ? 'fresh' : 'budget', ...(checkedAt !== undefined ? { checkedAt } : {}) };
  });
  return { kinds, skipped };
}

function pick(known: ListKind[], lastCommitAt: LastCommits, now: number, sizes: ListSizes): ListKind[] {
  const ordered = ORDER.filter((k) => known.includes(k));
  const stale = ordered.filter((k) => {
    const at = lastCommitAt[k];
    return at === undefined || now - at >= SKIP_FRESH_MS;
  });
  if (!stale.length) return [stalest(ordered, lastCommitAt)];
  if (stale.length === 1) return stale;
  // Unknown sizes count as zero: only a size known to exceed the budget splits the check.
  const knownTotal = stale.reduce((sum, k) => sum + (sizes[k] ?? 0), 0);
  return knownTotal > BOTH_LISTS_MAX ? [stalest(stale, lastCommitAt)] : stale;
}
