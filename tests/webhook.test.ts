import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseHeaders, renderTemplate, summarize, templateError, webhookOrigin, webhookPayload, webhookRequest, type WebhookPayload } from '../src/notify/format';
import type { EventRow } from '../src/db/schema';

const ev = (type: EventRow['type'], userId: string, handle: string, reason?: EventRow['reason']) =>
  ({ type, userId, handle, reason, at: 0, ownerId: 'me', scanId: 1 }) as EventRow;
const NOW = Date.UTC(2026, 9, 3, 12);
const payload = (): WebhookPayload =>
  webhookPayload([ev('LOST_FOLLOWER', '1', 'a', 'unfollowed'), ev('LOST_MUTUAL', '2', 'b')], ['2 left: @a, "@b"'], {
    account: 'me',
    boomerangs: new Map([['1', 3]]),
    now: NOW,
  });

describe('summarize', () => {
  it('never mentions people who did not leave: non-departure events notify nothing', () => {
    const notADeparture = [ev('RENAME', '1', 'a'), ev('NEW_FOLLOWING', '2', 'b'), ev('UNFOLLOWED_BY_ME', '3', 'c'), ev('NEW_MUTUAL', '4', 'd')];
    expect(summarize(notADeparture, { browser: true, newFollowers: true })).toBeNull();
    expect(summarize([ev('NEW_FOLLOWER', '5', 'e')], { browser: true, newFollowers: false })).toBeNull();
  });
  it('keeps likely_gone out of the "unfollowed you" line', () => {
    const s = summarize([ev('LOST_FOLLOWER', '1', 'a', 'unfollowed'), ev('LOST_FOLLOWER', '2', 'b', 'likely_gone')], { browser: true, newFollowers: false })!;
    expect(s.lines).toEqual(['1 unfollowed you: @a', '1 left (unfollowed or suspended/deleted): @b']);
  });
});

describe('webhookOrigin', () => {
  it('asks for the host only, on any port', () => {
    expect(webhookOrigin('https://hooks.example.com:8443/x?y=1')).toEqual({ origin: 'https://hooks.example.com/*' });
    expect(webhookOrigin(' http://localhost:5678/webhook ')).toEqual({ origin: 'http://localhost/*' });
    expect(webhookOrigin('http://127.0.0.1/hook')).toEqual({ origin: 'http://127.0.0.1/*' });
  });
  it('refuses plain http to other hosts, other schemes and garbage', () => {
    expect(webhookOrigin('http://example.com/hook')).toHaveProperty('error');
    expect(webhookOrigin('http://192.168.1.5/hook')).toHaveProperty('error');
    expect(webhookOrigin('ftp://example.com')).toHaveProperty('error');
    expect(webhookOrigin('not a url')).toHaveProperty('error');
  });
});

describe('parseHeaders', () => {
  it('parses lines and reports bad or forbidden ones', () => {
    expect(parseHeaders('Authorization: Bearer x:y\n\n X-Title :  Ghosted \nnope\nCookie: a=b')).toEqual({
      headers: { Authorization: 'Bearer x:y', 'X-Title': 'Ghosted' },
      invalid: ['nope', 'Cookie: a=b'],
    });
  });
});

describe('webhookPayload', () => {
  it('builds the standard body', () => {
    expect(payload()).toEqual({
      source: 'ghosted',
      account: '@me',
      at: '2026-10-03T12:00:00.000Z',
      summary: '2 left: @a, "@b"',
      count: 2,
      events: [
        { type: 'LOST_FOLLOWER', handle: 'a', id: '1', reason: 'unfollowed', boomerang: 3 },
        { type: 'LOST_MUTUAL', handle: 'b', id: '2' },
      ],
    });
  });
});

describe('renderTemplate', () => {
  it('escapes text for JSON strings so the body stays valid JSON', () => {
    const body = renderTemplate('{"text":"{{summary}} ({{ count }}) for {{account}}","list":{{events}},"x":"{{unknown}}"}', payload(), true);
    const parsed = JSON.parse(body);
    expect(parsed.text).toBe('2 left: @a, "@b" (2) for @me');
    expect(parsed.list).toHaveLength(2);
    expect(parsed.x).toBe('{{unknown}}');
  });
  it('inserts raw text for non-JSON bodies', () => {
    expect(renderTemplate('{{summary}}', payload(), false)).toBe('2 left: @a, "@b"');
  });
  it('{{json}} is the standard body', () => {
    expect(JSON.parse(renderTemplate('{"wrapped":{{json}}}', payload(), true)).wrapped).toEqual(payload());
  });
});

describe('webhookRequest', () => {
  it('defaults to the JSON body and content type', () => {
    const { url, init } = webhookRequest({ url: ' https://h.example/x ' }, payload());
    expect(url).toBe('https://h.example/x');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(payload());
  });
  it('respects a custom content type', () => {
    const { init } = webhookRequest({ url: 'https://h.example', headers: 'content-type: text/plain', template: '{{summary}}' }, payload());
    expect(init.headers).toEqual({ 'content-type': 'text/plain' });
    expect(init.body).toBe('2 left: @a, "@b"');
  });
});

describe('webhook delivery over HTTP', () => {
  let received: Array<{ method?: string; headers: IncomingHttpHeaders; body: string }> = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ method: req.method, headers: req.headers, body });
      res.writeHead(204).end();
    });
  });
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('posts the body and headers a server receives', async () => {
    received = [];
    const { url, init } = webhookRequest(
      { url: `${base}/hook`, headers: 'Authorization: Bearer secret', template: '{"text":"{{summary}}"}' },
      payload(),
    );
    const res = await fetch(url, init);
    expect(res.status).toBe(204);
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('POST');
    expect(received[0].headers.authorization).toBe('Bearer secret');
    expect(received[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(received[0].body)).toEqual({ text: '2 left: @a, "@b"' });
  });
});

describe('templates with real alert text', () => {
  const ctx = { account: 'me', now: NOW };
  it('keeps a multi-line summary valid inside a JSON string', () => {
    const events = [ev('LOST_FOLLOWER', '1', 'a', 'unfollowed'), ev('LOST_MUTUAL', '2', 'b'), ev('NEW_FOLLOWER', '3', 'c')];
    const s = summarize(events, { browser: true, newFollowers: true })!;
    const body = renderTemplate('{"text":"{{summary}}","when":"{{at}}","who":"{{account}}"}', webhookPayload(events, s.lines, ctx), true);
    const parsed = JSON.parse(body);
    expect(parsed.text.split('\n')).toEqual(s.lines);
    expect(parsed.text.split('\n')).toHaveLength(3);
    expect(parsed.when).toBe('2026-10-03T12:00:00.000Z');
    expect(parsed.who).toBe('@me');
  });
  it('escapes backslashes, tabs and emoji', () => {
    const p = webhookPayload([], ['tab\there \\ back 👻 "q"'], ctx);
    expect(JSON.parse(renderTemplate('{"t":"{{summary}}"}', p, true)).t).toBe('tab\there \\ back 👻 "q"');
  });
  it('a placeholder outside quotes gives invalid JSON, which templateError catches', () => {
    expect(templateError({ url: 'https://h.example', template: '{"text": {{summary}}}' })).toMatch(/JSON/);
    expect(templateError({ url: 'https://h.example', template: '{"text":"{{summary}}","n":{{count}},"e":{{events}}}' })).toBeNull();
    expect(templateError({ url: 'https://h.example', headers: 'Content-Type: text/plain', template: '{{summary}} not json' })).toBeNull();
    expect(templateError({ url: 'https://h.example' })).toBeNull();
  });
});
