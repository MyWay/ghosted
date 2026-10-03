import type { EventRow } from '../db/schema';

export interface NotifyPrefs {
  browser: boolean;
  newFollowers: boolean;
  telegram?: { token: string; chatId: string };
  discord?: { url: string };
  webhook?: WebhookConfig;
}

export interface WebhookConfig {
  url: string;
  /** One `Name: value` per line. */
  headers?: string;
  /** Request body with {{placeholders}}; empty sends the default JSON. */
  template?: string;
}

export const DEFAULT_PREFS: NotifyPrefs = { browser: true, newFollowers: false };

const NAME_LIMIT = 8;

function names(events: EventRow[]): string {
  const shown = events.slice(0, NAME_LIMIT).map((e) => `@${e.handle}`);
  const rest = events.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
}

/** One batched summary per committed scan; null when there is nothing worth telling. */
export function summarize(events: EventRow[], prefs: NotifyPrefs): { title: string; lines: string[] } | null {
  const by = (t: EventRow['type']) => events.filter((e) => e.type === t);
  const lost = by('LOST_FOLLOWER');
  const unfollowed = lost.filter((e) => e.reason !== 'likely_gone');
  const gone = lost.filter((e) => e.reason === 'likely_gone');
  const lostMutual = by('LOST_MUTUAL');
  const fresh = prefs.newFollowers ? by('NEW_FOLLOWER') : [];

  const lines: string[] = [];
  if (unfollowed.length) lines.push(`${unfollowed.length} unfollowed you: ${names(unfollowed)}`);
  if (gone.length) lines.push(`${gone.length} left (unfollowed or suspended/deleted): ${names(gone)}`);
  if (lostMutual.length) lines.push(`${lostMutual.length} you follow stopped following back: ${names(lostMutual)}`);
  if (fresh.length) lines.push(`${fresh.length} new follower${fresh.length === 1 ? '' : 's'}: ${names(fresh)}`);
  if (!lines.length) return null;
  return { title: 'Ghosted', lines };
}

// ---- webhook -----------------------------------------------------------

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Host permission pattern for a webhook URL, or an error. Plain http is only allowed to this
 * computer. Match patterns cannot name a port, so the pattern covers every port of the host.
 */
export function webhookOrigin(url: string): { origin: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { error: 'Webhook URL is not a valid URL.' };
  }
  if (u.protocol === 'https:') return { origin: `https://${u.hostname}/*` };
  if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return { origin: `http://${u.hostname}/*` };
  if (u.protocol === 'http:') return { error: 'Webhook URL must use https (plain http only for localhost).' };
  return { error: 'Webhook URL must start with https://' };
}

const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'cookie', 'origin', 'referer']);

/** Parse `Name: value` lines; returns the invalid lines too so Settings can point at them. */
export function parseHeaders(text = ''): { headers: Record<string, string>; invalid: string[] } {
  const headers: Record<string, string> = {};
  const invalid: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(':');
    const name = i > 0 ? line.slice(0, i).trim() : '';
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      invalid.push(line);
      continue;
    }
    headers[name] = line.slice(i + 1).trim();
  }
  return { headers, invalid };
}

export interface WebhookEvent {
  type: EventRow['type'];
  handle: string;
  id: string;
  reason?: EventRow['reason'];
  /** Times this person has unfollowed you, when more than once. */
  boomerang?: number;
}

export interface WebhookPayload {
  source: 'ghosted';
  test?: true;
  account?: string;
  at: string;
  summary: string;
  count: number;
  events: WebhookEvent[];
}

export function webhookPayload(
  events: EventRow[],
  lines: string[],
  ctx: { account?: string; boomerangs?: Map<string, number>; now: number; test?: boolean },
): WebhookPayload {
  return {
    source: 'ghosted',
    ...(ctx.test ? { test: true as const } : {}),
    ...(ctx.account ? { account: `@${ctx.account}` } : {}),
    at: new Date(ctx.now).toISOString(),
    summary: lines.join('\n'),
    count: events.length,
    events: events.map((e) => ({
      type: e.type,
      handle: e.handle,
      id: e.userId,
      ...(e.reason ? { reason: e.reason } : {}),
      ...(ctx.boomerangs?.get(e.userId) ? { boomerang: ctx.boomerangs.get(e.userId) } : {}),
    })),
  };
}

/**
 * Fill {{summary}} {{count}} {{account}} {{at}} {{events}} (and {{json}}, the whole default body).
 * For a JSON body, text placeholders are escaped to sit inside a JSON string: `{"text":"{{summary}}"}`.
 * Unknown placeholders are left as they are.
 */
export function renderTemplate(template: string, p: WebhookPayload, json: boolean): string {
  const text = (v: string) => (json ? JSON.stringify(v).slice(1, -1) : v);
  const values: Record<string, () => string> = {
    summary: () => text(p.summary),
    count: () => String(p.count),
    account: () => text(p.account ?? ''),
    at: () => text(p.at),
    events: () => JSON.stringify(p.events),
    json: () => JSON.stringify(p),
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => values[key]?.() ?? m);
}

/** Request for a webhook delivery; JSON unless the user set another Content-Type. */
export function webhookRequest(cfg: WebhookConfig, p: WebhookPayload): { url: string; init: RequestInit } {
  const { headers } = parseHeaders(cfg.headers);
  const typeKey = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type');
  if (!typeKey) headers['Content-Type'] = 'application/json';
  const json = /json/i.test(typeKey ? headers[typeKey] : 'application/json');
  const body = cfg.template?.trim() ? renderTemplate(cfg.template, p, json) : JSON.stringify(p);
  return { url: cfg.url.trim(), init: { method: 'POST', headers, body } };
}

/** Why a JSON body template would not produce valid JSON (tried on a sample alert), or null. */
export function templateError(cfg: WebhookConfig): string | null {
  if (!cfg.template?.trim()) return null;
  const sample = webhookPayload(
    [{ type: 'LOST_FOLLOWER', handle: 'example', userId: '0', reason: 'unfollowed' } as EventRow],
    ['1 unfollowed you: @example', '1 new follower: "@other"'],
    { account: 'you', now: 0 },
  );
  const { init } = webhookRequest(cfg, sample);
  const type = Object.entries(init.headers as Record<string, string>).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (!/json/i.test(type)) return null;
  try {
    JSON.parse(init.body as string);
    return null;
  } catch {
    return 'Webhook body is not valid JSON. Put text placeholders inside quotes, like "{{summary}}", or set a Content-Type header for plain text.';
  }
}
