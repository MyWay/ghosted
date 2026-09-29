import { describe, expect, it } from 'vitest';
import { applyPage, evaluate, needsReview, type SessionState } from '../src/core/session';
import type { ParsedPage } from '../src/core/types';
import { mkUsers } from './helpers';

const page = (n: number, bottomCursor?: string, extra: Partial<ParsedPage> = {}): ParsedPage => ({
  users: mkUsers(1, n).map((u) => ({ id: u.id, handle: u.handle, name: u.handle })),
  bottomCursor,
  warnings: 0,
  unavailable: 0,
  ...extra,
});
const base = { ownerId: '1', kind: 'followers' as const, now: 1000 };

function run(pages: Array<{ req?: string; page: ParsedPage; total: number }>): SessionState {
  let s: SessionState | null = null;
  for (const p of pages) s = applyPage(s, { ...base, requestCursor: p.req, page: p.page, collectedTotal: p.total });
  return s!;
}

describe('session', () => {
  it('completes after an empty final page and meets the count threshold', () => {
    const s = run([
      { page: page(50, 'c1'), total: 50 },
      { req: 'c1', page: page(50, 'c2'), total: 100 },
      { req: 'c2', page: { ...page(0, 'c3') }, total: 100 },
    ]);
    expect(evaluate(s, 100)).toEqual({ status: 'complete', expectedKnown: true });
  });
  it('is still collecting before the end', () => {
    expect(evaluate(run([{ page: page(50, 'c1'), total: 50 }]), 100).status).toBe('collecting');
  });
  it('treats a missing or 0| cursor as the end', () => {
    expect(run([{ page: page(5), total: 5 }]).endReached).toBe(true);
    expect(run([{ page: page(5, '0|0'), total: 5 }]).endReached).toBe(true);
  });
  it('is invalid when the scan did not start at the top', () => {
    const s = run([{ req: 'mid', page: page(5), total: 5 }]);
    expect(evaluate(s, 5)).toMatchObject({ status: 'invalid' });
  });
  it('is invalid on a cursor gap', () => {
    const s = run([
      { page: page(50, 'c1'), total: 50 },
      { req: 'zzz', page: page(0), total: 50 },
    ]);
    expect(s.gap).toBe(true);
    expect(evaluate(s, 50)).toMatchObject({ status: 'invalid' });
  });
  it('is invalid when entries failed to parse', () => {
    const s = run([{ page: page(5, undefined, { warnings: 2 }), total: 5 }]);
    expect(evaluate(s, 5)).toMatchObject({ status: 'invalid' });
  });
  it('is invalid below the count threshold, counting unavailable accounts as seen', () => {
    const low = run([{ page: page(90), total: 90 }]);
    expect(evaluate(low, 100).status).toBe('invalid');
    const withGone = run([{ page: page(90, undefined, { unavailable: 8 }), total: 90 }]);
    expect(evaluate(withGone, 100).status).toBe('complete');
  });
  it('completes with expectedKnown=false when no count is known', () => {
    expect(evaluate(run([{ page: page(5), total: 5 }]), undefined)).toEqual({ status: 'complete', expectedKnown: false });
  });
  it('restarts on a request without a cursor', () => {
    const s = run([
      { page: page(50, 'c1'), total: 50 },
      { page: page(10, 'd1'), total: 10 },
    ]);
    expect(s.pages).toBe(1);
    expect(s.bottomCursors).toEqual(['d1']);
  });
  it('detects a repeated bottom cursor as the end', () => {
    const s = run([
      { page: page(5, 'c1'), total: 5 },
      { req: 'c1', page: page(5, 'c1'), total: 5 },
    ]);
    expect(s.endReached).toBe(true);
  });
});

describe('needsReview', () => {
  it('flags large removals only', () => {
    expect(needsReview(1000, 30)).toBe(false);
    expect(needsReview(1000, 51)).toBe(true);
    expect(needsReview(100, 26)).toBe(true);
    expect(needsReview(100, 25)).toBe(false);
  });
});

describe('session: side pages never end or break a scan', () => {
  it('a top-cursor request with no users does not end the scan or count as a gap', () => {
    let s = applyPage(null, { ...base, page: { ...page(50, 'c1'), topCursor: 't1' }, collectedTotal: 50 });
    s = applyPage(s, { ...base, requestCursor: 't1', page: { ...page(0), topCursor: 't2' }, collectedTotal: 50 });
    expect(s.endReached).toBe(false);
    expect(s.gap).toBe(false);
    expect(s.topCursors).toEqual(['t1', 't2']);
    s = applyPage(s, { ...base, requestCursor: 't2', page: page(0), collectedTotal: 50 });
    expect(s.endReached).toBe(false);
    s = applyPage(s, { ...base, requestCursor: 'c1', page: page(0, 'c2'), collectedTotal: 50 });
    expect(s.endReached).toBe(true);
    expect(evaluate(s, 50).status).toBe('complete');
  });

  it('a retried request (same cursor, same bottom cursor) does not look like the end', () => {
    let s = applyPage(null, { ...base, page: page(50, 'c1'), collectedTotal: 50 });
    s = applyPage(s, { ...base, requestCursor: 'c1', page: page(50, 'c2'), collectedTotal: 100 });
    s = applyPage(s, { ...base, requestCursor: 'c1', page: page(50, 'c2'), collectedTotal: 100 });
    expect(s.endReached).toBe(false);
    expect(s.pages).toBe(2);
  });

  it('tolerates states persisted before cursor lists existed', () => {
    const s = applyPage(null, { ...base, page: page(5, 'c1'), collectedTotal: 5 });
    const legacy = { ...s, topCursors: undefined, requestedCursors: undefined } as unknown as SessionState;
    expect(() => applyPage(legacy, { ...base, requestCursor: 'c1', page: page(0), collectedTotal: 5 })).not.toThrow();
  });
});

describe('needsReview strict', () => {
  it('is stricter when completeness is unverified', () => {
    expect(needsReview(100, 6)).toBe(false);
    expect(needsReview(100, 6, true)).toBe(true);
    expect(needsReview(1000, 11, true)).toBe(true);
    expect(needsReview(1000, 10, true)).toBe(false);
  });
});
