import { describe, expect, it } from 'vitest';
import { rateLimitFrom } from '../src/messages';

describe('rateLimitFrom', () => {
  it('keeps finite numeric counters', () => {
    expect(rateLimitFrom({ limit: 50, remaining: 3, reset: 1_800_000_000 })).toEqual({ limit: 50, remaining: 3, reset: 1_800_000_000 });
  });

  it('drops anything that is not a finite number, and empty objects entirely', () => {
    expect(rateLimitFrom({ limit: '50', remaining: NaN, reset: 7, token: 'secret' })).toEqual({ limit: undefined, remaining: undefined, reset: 7 });
    expect(rateLimitFrom({ limit: 'x' })).toBeUndefined();
    expect(rateLimitFrom(null)).toBeUndefined();
    expect(rateLimitFrom('50')).toBeUndefined();
  });
});
