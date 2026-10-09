import type { ListKind } from '../core/types';
import type { Outcome, Progress } from './autoscroll';

const listName = (kind: ListKind) => (kind === 'followers' ? 'Followers' : 'Following');

export interface DoneInfo {
  kind: ListKind;
  /** The list the check continues with, and roughly when its page opens (ms). */
  next?: { kind: ListKind; inMs: number };
  /** This list's first-ever check: it saved a starting point, so there are no changes yet. */
  baseline?: boolean;
  /** Profiles the check visits next, of followers who seem to have left. */
  checks?: number;
}

const people = (n: number) => (n === 1 ? '1 follower' : `${n} followers`);

/**
 * Panel text when a list ends. While another list follows it must not sound finished: people
 * close the tab on "complete" and the second list never runs.
 */
export function doneText(outcome: Outcome, info: DoneInfo): { text: string; keepOpen: boolean } {
  const list = listName(info.kind);
  if (info.next && (outcome === 'complete' || outcome === 'invalid')) {
    const first =
      outcome === 'complete' ? `${list} list done.` : `${list} list could not be verified as complete; nothing was changed for it.`;
    return { text: `${first} Keep this tab open: the ${info.next.kind} list is next.`, keepOpen: true };
  }
  if (info.checks && (outcome === 'complete' || outcome === 'invalid')) {
    const first = outcome === 'complete' ? `${list} list done.` : `${list} list could not be verified as complete; nothing was changed for it.`;
    return {
      text: `${first} Keep this tab open: checking the profiles of ${people(info.checks)} missing from your list, to see if they really left.`,
      keepOpen: true,
    };
  }
  switch (outcome) {
    case 'complete':
      return {
        text: info.baseline
          ? 'Check complete. This first check saved your starting point: changes show from your next check. You can close this tab.'
          : 'Check complete. You can close this tab.',
        keepOpen: false,
      };
    case 'invalid':
      return { text: `${list} list could not be verified as complete; nothing was changed.`, keepOpen: false };
    case 'stopped':
      return { text: 'Check stopped.', keepOpen: false };
    case 'timeout':
      return { text: 'No progress for 3 minutes; check abandoned.', keepOpen: false };
    case 'rate-limited':
      return {
        text: 'X is limiting requests, so this check stopped. Try again in about 15 minutes, or pick a slower check speed in Settings.',
        keepOpen: false,
      };
  }
}

/** "45 s", "1 min 30 s". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
}

/** Small status panel in a shadow root so X's CSS cannot affect it (and it cannot affect X). */
export class Overlay {
  onPause: (paused: boolean) => void = () => {};
  onStop: () => void = () => {};
  private host: HTMLElement;
  private title: HTMLElement;
  private text: HTMLElement;
  private wait: HTMLElement;
  private bar: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private paused = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(step?: { index: number; total: number }) {
    this.host = document.createElement('div');
    this.host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = this.host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .card{font:13px system-ui,sans-serif;background:#1e1d1a;color:#f7f1e8;border:1px solid #f7f1e833;border-radius:10px;padding:12px 14px;width:260px;box-shadow:0 8px 30px #0008}
        .title{font-weight:700;color:#e0a33a;margin-bottom:6px}
        .wait{margin-top:6px;color:#62d6d0;font-weight:600}
        .wait:empty{display:none}
        .track{height:5px;background:#ffffff1a;border-radius:99px;overflow:hidden;margin:8px 0}
        .fill{height:100%;width:0;background:linear-gradient(90deg,#e0a33a,#62d6d0);transition:width .3s}
        button{font:inherit;cursor:pointer;border:1px solid #f7f1e833;background:#ffffff14;color:inherit;border-radius:6px;padding:4px 10px;margin-right:6px}
      </style>
      <div class="card">
        <div class="title"></div>
        <div class="text">Waiting for the first page…</div>
        <div class="wait"></div>
        <div class="track"><div class="fill"></div></div>
        <button class="pause">Pause</button><button class="stop">Stop</button>
      </div>`;
    this.title = root.querySelector('.title')!;
    this.text = root.querySelector('.text')!;
    this.wait = root.querySelector('.wait')!;
    this.bar = root.querySelector('.fill')!;
    this.pauseBtn = root.querySelector('.pause')!;
    this.stopBtn = root.querySelector('.stop')!;
    this.title.textContent = step && step.total > 1 ? `Ghosted · checking list ${step.index} of ${step.total}` : 'Ghosted · checking';
    this.pauseBtn.onclick = () => {
      this.paused = !this.paused;
      this.pauseBtn.textContent = this.paused ? 'Resume' : 'Pause';
      this.onPause(this.paused);
    };
    this.stopBtn.onclick = () => this.onStop();
    document.documentElement.appendChild(this.host);
  }

  update(kind: ListKind, p: Progress) {
    const total = p.expected ? ` of ~${p.expected}` : '';
    this.text.textContent = `${listName(kind)}: ${p.collected}${total} collected`;
    if (p.expected) this.bar.style.width = `${Math.min(100, Math.round((p.collected / p.expected) * 100))}%`;
  }

  /** On a follower's profile the check is visiting. */
  checking(c: { handle: string; index: number; total: number }) {
    this.title.textContent = 'Ghosted · checking profiles';
    this.text.textContent = `Does @${c.handle} still follow you? (${c.index} of ${c.total})`;
    this.bar.style.width = `${Math.round(((c.index - 1) / c.total) * 100)}%`;
    this.pauseBtn.remove();
  }

  /** The profile checks are over: the whole check is. */
  checksDone(rateLimited = false) {
    this.text.textContent = rateLimited
      ? 'X is limiting requests, so the profile checks stopped. The rest are checked next time. You can close this tab.'
      : 'Check complete. You can close this tab.';
    if (!rateLimited) this.bar.style.width = '100%';
    this.pauseBtn.remove();
    this.stopBtn.textContent = 'Close';
    this.stopBtn.onclick = () => this.host.remove();
    setTimeout(() => this.host.remove(), 15_000);
  }

  done(outcome: Outcome, info: DoneInfo) {
    const { text, keepOpen } = doneText(outcome, info);
    this.text.textContent = text;
    this.pauseBtn.remove();
    if (outcome === 'complete') this.bar.style.width = '100%';
    if (keepOpen && info.checks) {
      // The panel goes away by itself when the tab opens the first profile.
      this.stopBtn.remove();
      return;
    }
    if (keepOpen && info.next) {
      // The panel goes away by itself when the tab moves on to the next list.
      this.stopBtn.remove();
      const until = Date.now() + info.next.inMs;
      const tick = () => {
        const left = until - Date.now();
        this.wait.textContent = left > 0 ? `Starting in ${countdown(left)}…` : 'Starting…';
        if (left <= 0) clearInterval(this.timer);
      };
      tick();
      this.timer = setInterval(tick, 1000);
      return;
    }
    this.stopBtn.textContent = 'Close';
    this.stopBtn.onclick = () => this.host.remove();
    setTimeout(() => this.host.remove(), 15_000);
  }
}
