/**
 * How fast an assisted check moves through the lists. Slower pacing sends X fewer page requests per
 * minute, which makes rate limits less likely on big accounts. X does not publish its limits, so no
 * pace can guarantee avoiding them.
 */
export type Pace = 'normal' | 'careful' | 'slow';

export interface PaceConfig {
  /** Random pause after each loaded page, in ms. */
  pageWaitMs: [number, number];
  /** Random pause between the following and followers lists, in ms. */
  betweenListsMs: [number, number];
  /** Random pause before each follower profile a check visits, in ms. */
  checkWaitMs: [number, number];
}

export const PACES: Record<Pace, PaceConfig> = {
  normal: { pageWaitMs: [350, 900], betweenListsMs: [4_000, 8_000], checkWaitMs: [1_500, 3_000] },
  careful: { pageWaitMs: [1_500, 3_000], betweenListsMs: [30_000, 45_000], checkWaitMs: [4_000, 7_000] },
  slow: { pageWaitMs: [4_000, 7_000], betweenListsMs: [60_000, 90_000], checkWaitMs: [8_000, 12_000] },
};

export const DEFAULT_PACE: Pace = 'normal';

export const asPace = (v: unknown): Pace => (v === 'careful' || v === 'slow' || v === 'normal' ? v : DEFAULT_PACE);

export const randomIn = ([min, max]: [number, number], rnd: () => number = Math.random) => min + rnd() * (max - min);
