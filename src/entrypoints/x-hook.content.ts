import { CHANNEL, type PageCapture } from '../messages';

const MATCH =
  /\/i\/api\/graphql\/[^/]+\/(Following|Followers|UserByScreenName)(?:[/?]|$)|\/i\/api\/1\.1\/friendships\/destroy\.json/;

/**
 * Runs in the page's own JS world. It only OBSERVES responses X's web app already fetches (the
 * followers / following lists, your profile, and your own unfollow clicks); it never issues
 * requests and never reads or stores auth headers.
 */
export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const post = (url: string, status: number, body: unknown, requestBody?: string) => {
      try {
        const msg: PageCapture = { channel: CHANNEL, url, status, body, requestBody };
        window.postMessage(msg, window.location.origin);
      } catch {
        /* never break the page */
      }
    };
    const bodyText = (b: unknown): string | undefined =>
      typeof b === 'string' ? b : b instanceof URLSearchParams ? b.toString() : undefined;

    const originalFetch = window.fetch;
    window.fetch = function patchedFetch(...args: Parameters<typeof fetch>) {
      // Always call with `window` as receiver: a foreign `this` throws "Illegal invocation".
      const promise = originalFetch.apply(window, args);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url;
        if (url && MATCH.test(url)) {
          const requestBody = bodyText(args[1]?.body);
          promise
            .then((res) =>
              res
                .clone()
                .json()
                .then(
                  (body) => post(url, res.status, body, requestBody),
                  () => post(url, res.status, null, requestBody),
                ),
            )
            .catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return promise;
    };

    const matched = new WeakMap<XMLHttpRequest, { url: string; body?: string }>();
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      try {
        const href = String(url);
        if (MATCH.test(href)) {
          matched.set(this, { url: href });
          this.addEventListener('load', () => {
            const info = matched.get(this);
            if (!info) return;
            // Only text / JSON bodies are readable; skip anything else rather than report garbage.
            if (this.responseType !== '' && this.responseType !== 'text' && this.responseType !== 'json') return;
            let raw: unknown = null;
            try {
              raw = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
            } catch {
              /* unparseable: reported as null */
            }
            post(info.url, this.status, raw, info.body);
          });
        } else {
          matched.delete(this);
        }
      } catch {
        /* ignore */
      }
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      try {
        const info = matched.get(this);
        if (info) info.body = bodyText(body);
      } catch {
        /* ignore */
      }
      return send.call(this, body);
    };
  },
});
