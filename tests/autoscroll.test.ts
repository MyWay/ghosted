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

  it('waits when X refuses a page and says when it resets, instead of ending the check', () => {
    const onDone = vi.fn();
    const onWait = vi.fn();
    const s = new AutoScroller('followers', { onProgress: () => {}, onDone, onWait });
    s.start();
    const resumeAt = Date.now() + 10 * 60_000;
    s.onCapture({ handled: true, kind: 'followers', status: 'collecting', rateLimited: true, resumeAt });
    // X retrying by itself during the wait is the same wait, not a failed one.
    s.onCapture({ handled: true, kind: 'followers', status: 'collecting', rateLimited: true, resumeAt });
    s.onCapture({ handled: true, kind: 'followers', status: 'collecting', rateLimited: true, resumeAt });
    expect(onDone).not.toHaveBeenCalled();
    expect(onWait.mock.calls[0][0]).toBeGreaterThanOrEqual(resumeAt);
    s.stop();
    expect(onDone).toHaveBeenCalledWith('stopped');
  });

  it('waits after the last page X allows in a window', () => {
    const onDone = vi.fn();
    const onWait = vi.fn();
    const onProgress = vi.fn();
    const s = new AutoScroller('followers', { onProgress, onDone, onWait });
    s.start();
    s.onCapture({ handled: true, kind: 'followers', status: 'collecting', collected: 2450, expected: 2550, resumeAt: Date.now() + 60_000 });
    expect(onProgress).toHaveBeenCalledWith({ collected: 2450, expected: 2550 });
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    s.stop();
  });

  it('ends the check when X refuses a page and waiting cannot help', () => {
    const onDone = vi.fn();
    const s = new AutoScroller('followers', { onProgress: () => {}, onDone });
    s.start();
    s.onCapture({ handled: true, kind: 'followers', status: 'error', rateLimited: true });
    expect(onDone).toHaveBeenCalledWith('rate-limited');
  });
});
