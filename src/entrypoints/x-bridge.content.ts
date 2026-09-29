import { browser } from 'wxt/browser';
import { handleFromProfileHref } from '../core/owner';
import type { ListKind } from '../core/types';
import { CHANNEL, type BridgeReadyReply, type CaptureReply, type PageCapture, type ToBackground } from '../messages';
import { AutoScroller } from '../bridge/autoscroll';
import { Overlay } from '../bridge/overlay';

async function send<T>(msg: ToBackground): Promise<T | undefined> {
  try {
    return (await browser.runtime.sendMessage(msg)) as T;
  } catch {
    return undefined; // extension reloaded / background asleep: drop silently
  }
}

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  runAt: 'document_start',
  main() {
    let scroller: AutoScroller | null = null;
    let overlay: Overlay | null = null;
    // Captures can finish (even commit a small list) before the scroller exists; keep the last one.
    let lastReply: CaptureReply | undefined;

    window.addEventListener('message', async (ev: MessageEvent) => {
      if (ev.source !== window) return;
      const data = ev.data as Partial<PageCapture> | null;
      if (!data || data.channel !== CHANNEL || typeof data.url !== 'string') return;
      const reply = await send<CaptureReply>({
        type: 'capture',
        url: data.url,
        status: data.status ?? 0,
        body: data.body,
        requestBody: typeof data.requestBody === 'string' ? data.requestBody : undefined,
      });
      if (!reply?.handled) return;
      lastReply = reply;
      scroller?.onCapture(reply);
    });

    const reportHandle = (attempt = 0) => {
      const handle = handleFromProfileHref(
        document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href'),
      );
      if (handle) void send({ type: 'owner-handle', handle });
      else if (attempt < 30) setTimeout(() => reportHandle(attempt + 1), 1000);
    };

    const start = async (kind: ListKind) => {
      overlay = new Overlay();
      scroller = new AutoScroller(kind, {
        onProgress: (p) => overlay?.update(kind, p),
        onDone: (outcome) => {
          overlay?.done(outcome);
          scroller = null;
          void send({ type: 'scan-finished', kind, outcome });
        },
      });
      overlay.onPause = (paused) => scroller?.setPaused(paused);
      overlay.onStop = () => scroller?.stop();
      scroller.start(lastReply);
    };

    const init = async () => {
      reportHandle();
      const reply = await send<BridgeReadyReply>({ type: 'bridge-ready', path: location.pathname });
      if (reply?.autoscroll) void start(reply.autoscroll);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void init());
    else void init();
  },
});
