import { browser } from 'wxt/browser';
import type { EventRow } from '../db/schema';
import { DEFAULT_PREFS, summarize, webhookOrigin, webhookPayload, webhookRequest, type NotifyPrefs, type WebhookConfig, type WebhookPayload } from './format';

/** An alert service that has not answered by then is treated as failed. */
const SEND_TIMEOUT_MS = 10_000;

export type Channel = 'browser' | 'telegram' | 'discord' | 'webhook';

/** Last failure per channel, cleared by the next success; shown in Settings. */
export type NotifyErrors = Partial<Record<Channel, { at: number; message: string }>>;

export async function loadNotifyErrors(): Promise<NotifyErrors> {
  return ((await browser.storage.local.get('notifyErrors')).notifyErrors as NotifyErrors | undefined) ?? {};
}

async function track(channel: Channel, job: Promise<unknown>): Promise<void> {
  let error: { at: number; message: string } | undefined;
  try {
    await job;
  } catch (e) {
    error = { at: Date.now(), message: e instanceof Error ? e.message : String(e) };
  }
  const errors = await loadNotifyErrors();
  if (!error && !errors[channel]) return;
  if (error) errors[channel] = error;
  else delete errors[channel];
  await browser.storage.local.set({ notifyErrors: errors });
}

/** fetch with the alert timeout; network failures and timeouts become a readable error. */
async function send(service: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  } catch (e) {
    const why = e instanceof Error && e.name === 'TimeoutError' ? `no answer within ${SEND_TIMEOUT_MS / 1000} s` : e instanceof Error ? e.message : String(e);
    throw new Error(`Could not reach ${service} (${why}).`);
  }
}

export async function loadPrefs(): Promise<NotifyPrefs> {
  const stored = await browser.storage.local.get('notifyPrefs');
  return { ...DEFAULT_PREFS, ...(stored.notifyPrefs as Partial<NotifyPrefs> | undefined) };
}

export async function savePrefs(prefs: NotifyPrefs): Promise<void> {
  await browser.storage.local.set({ notifyPrefs: prefs });
}

export async function sendBrowser(title: string, message: string, id?: string): Promise<void> {
  await browser.notifications.create(id ?? '', {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title,
    message,
  });
}

export async function sendTelegram(cfg: { token: string; chatId: string }, text: string): Promise<void> {
  const res = await send('Telegram', `https://api.telegram.org/bot${cfg.token.trim()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
}

export async function sendDiscord(cfg: { url: string }, text: string): Promise<void> {
  const res = await send('Discord', cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: text }),
  });
  if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
}

/** False when the user never granted, or later revoked (Firefox: about:addons), the webhook's host. */
export async function webhookAllowed(url: string): Promise<boolean> {
  const o = webhookOrigin(url);
  return 'origin' in o && (await browser.permissions.contains({ origins: [o.origin] }));
}

export async function sendWebhook(cfg: WebhookConfig, payload: WebhookPayload): Promise<void> {
  if (!(await webhookAllowed(cfg.url))) throw new Error('No permission for the webhook URL. Save it again in Settings to grant it.');
  const { url, init } = webhookRequest(cfg, payload);
  const res = await send('the webhook URL', url, init);
  if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
}

export interface NotifyContext {
  /** Owner's handle, without @. */
  account?: string;
  /** Unfollow count per user id, for people who unfollowed more than once. */
  boomerangs?: Map<string, number>;
}

/** Send a batched notification for a committed scan over every enabled channel. */
export async function notifyEvents(events: EventRow[], ctx: NotifyContext = {}): Promise<void> {
  const prefs = await loadPrefs();
  const summary = summarize(events, prefs);
  if (!summary) return;
  const text = summary.lines.join('\n');
  const jobs: Promise<unknown>[] = [];
  if (prefs.browser) jobs.push(track('browser', sendBrowser(summary.title, text)));
  if (prefs.telegram?.token && prefs.telegram.chatId) jobs.push(track('telegram', sendTelegram(prefs.telegram, `${summary.title}\n${text}`)));
  if (prefs.discord?.url) jobs.push(track('discord', sendDiscord(prefs.discord, `**${summary.title}**\n${text}`)));
  if (prefs.webhook?.url) {
    const told = (e: EventRow) => e.type === 'LOST_FOLLOWER' || e.type === 'LOST_MUTUAL' || (prefs.newFollowers && e.type === 'NEW_FOLLOWER');
    jobs.push(track('webhook', sendWebhook(prefs.webhook, webhookPayload(events.filter(told), summary.lines, { ...ctx, now: Date.now() }))));
  }
  await Promise.allSettled(jobs);
}

/** A test result also updates the channel's last error, so a fixed setup clears the warning. */
export async function testChannel(channel: Channel, account?: string): Promise<void> {
  const job = runTest(channel, account);
  await track(channel, job);
  return job;
}

async function runTest(channel: Channel, account?: string): Promise<void> {
  const prefs = await loadPrefs();
  const text = 'Test notification from Ghosted.';
  if (channel === 'webhook') {
    if (!prefs.webhook) throw new Error('Webhook is not configured');
    const sample = { type: 'LOST_FOLLOWER', handle: 'example', userId: '0', reason: 'unfollowed' } as EventRow;
    return sendWebhook(prefs.webhook, webhookPayload([sample], [text], { account, now: Date.now(), test: true }));
  }
  if (channel === 'browser') return sendBrowser('Ghosted', text);
  if (channel === 'telegram') {
    if (!prefs.telegram) throw new Error('Telegram is not configured');
    return sendTelegram(prefs.telegram, text);
  }
  if (!prefs.discord) throw new Error('Discord is not configured');
  return sendDiscord(prefs.discord, text);
}
