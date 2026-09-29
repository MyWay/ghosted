import { browser } from 'wxt/browser';
import type { EventRow } from '../db/schema';
import { DEFAULT_PREFS, summarize, type NotifyPrefs } from './format';

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
  const res = await fetch(`https://api.telegram.org/bot${cfg.token.trim()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
}

export async function sendDiscord(cfg: { url: string }, text: string): Promise<void> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: text }),
  });
  if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
}

/** Send a batched notification for a committed scan over every enabled channel. */
export async function notifyEvents(events: EventRow[]): Promise<void> {
  const prefs = await loadPrefs();
  const summary = summarize(events, prefs);
  if (!summary) return;
  const text = summary.lines.join('\n');
  const jobs: Promise<unknown>[] = [];
  if (prefs.browser) jobs.push(sendBrowser(summary.title, text));
  if (prefs.telegram?.token && prefs.telegram.chatId) jobs.push(sendTelegram(prefs.telegram, `${summary.title}\n${text}`));
  if (prefs.discord?.url) jobs.push(sendDiscord(prefs.discord, `**${summary.title}**\n${text}`));
  await Promise.allSettled(jobs);
}

export async function testChannel(channel: 'browser' | 'telegram' | 'discord'): Promise<void> {
  const prefs = await loadPrefs();
  const text = 'Test notification from Ghosted.';
  if (channel === 'browser') return sendBrowser('Ghosted', text);
  if (channel === 'telegram') {
    if (!prefs.telegram) throw new Error('Telegram is not configured');
    return sendTelegram(prefs.telegram, text);
  }
  if (!prefs.discord) throw new Error('Discord is not configured');
  return sendDiscord(prefs.discord, text);
}
