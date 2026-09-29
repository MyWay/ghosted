import { describe, expect, it, vi } from 'vitest';
import { AutoScroller } from '../src/bridge/autoscroll';

describe('AutoScroller', () => {
  it('finishes immediately when the list was already committed before it started', () => {
    const onDone = vi.fn();
    const s = new AutoScroller('following', { onProgress: () => {}, onDone });
    s.start({ handled: true, kind: 'following', status: 'committed', collected: 12, expected: 12 });
    expect(onDone).toHaveBeenCalledWith('complete');
  });

  it('ignores a replayed capture for the other list', () => {
    const onDone = vi.fn();
    const s = new AutoScroller('followers', { onProgress: () => {}, onDone });
    s.start({ handled: true, kind: 'following', status: 'committed' });
    expect(onDone).not.toHaveBeenCalled();
    s.stop();
    expect(onDone).toHaveBeenCalledWith('stopped');
  });

  it('reports done only once', () => {
    const onDone = vi.fn();
    const s = new AutoScroller('following', { onProgress: () => {}, onDone });
    s.start({ handled: true, kind: 'following', status: 'committed' });
    s.onCapture({ handled: true, kind: 'following', status: 'invalid' });
    s.stop();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
