import type { ListKind } from '../core/types';
import type { Outcome, Progress } from './autoscroll';

const OUTCOME_TEXT: Record<Outcome, string> = {
  complete: 'Check complete. You can close this panel.',
  invalid: 'Scan could not be verified as complete; nothing was changed.',
  stopped: 'Scan stopped.',
  timeout: 'No progress for 3 minutes; scan abandoned.',
  'rate-limited': 'X rate-limited the list; scan abandoned. Try again later.',
};

/** Small status panel in a shadow root so X's CSS cannot affect it (and it cannot affect X). */
export class Overlay {
  onPause: (paused: boolean) => void = () => {};
  onStop: () => void = () => {};
  private host: HTMLElement;
  private text: HTMLElement;
  private bar: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private paused = false;

  constructor() {
    this.host = document.createElement('div');
    this.host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = this.host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .card{font:13px system-ui,sans-serif;background:#1e1d1a;color:#f7f1e8;border:1px solid #f7f1e833;border-radius:10px;padding:12px 14px;width:260px;box-shadow:0 8px 30px #0008}
        .title{font-weight:700;color:#e0a33a;margin-bottom:6px}
        .track{height:5px;background:#ffffff1a;border-radius:99px;overflow:hidden;margin:8px 0}
        .fill{height:100%;width:0;background:linear-gradient(90deg,#e0a33a,#62d6d0);transition:width .3s}
        button{font:inherit;cursor:pointer;border:1px solid #f7f1e833;background:#ffffff14;color:inherit;border-radius:6px;padding:4px 10px;margin-right:6px}
      </style>
      <div class="card">
        <div class="title">Ghosted · checking</div>
        <div class="text">Waiting for the first page…</div>
        <div class="track"><div class="fill"></div></div>
        <button class="pause">Pause</button><button class="stop">Stop</button>
      </div>`;
    this.text = root.querySelector('.text')!;
    this.bar = root.querySelector('.fill')!;
    this.pauseBtn = root.querySelector('.pause')!;
    this.stopBtn = root.querySelector('.stop')!;
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
    this.text.textContent = `${kind}: ${p.collected}${total} collected`;
    if (p.expected) this.bar.style.width = `${Math.min(100, Math.round((p.collected / p.expected) * 100))}%`;
  }

  done(outcome: Outcome) {
    this.text.textContent = OUTCOME_TEXT[outcome];
    this.pauseBtn.remove();
    this.stopBtn.textContent = 'Close';
    this.stopBtn.onclick = () => this.host.remove();
    if (outcome === 'complete') this.bar.style.width = '100%';
    setTimeout(() => this.host.remove(), 15_000);
  }
}
