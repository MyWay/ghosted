<script lang="ts">
  import { browser } from 'wxt/browser';
  import { repo } from '../../ui/repo';
  import { download, toCsv } from '../../ui/format';
  import { loadPrefs, savePrefs } from '../../notify';
  import { DEFAULT_THRESHOLD } from '../../core/session';
  import { DEFAULT_PACE, asPace, type Pace } from '../../core/pace';
  import { buildDiagnostics } from '../../db/diagnostics';
  import { DEFAULT_PREFS, type NotifyPrefs } from '../../notify/format';

  let { ownerId }: { ownerId?: string } = $props();

  let threshold = $state(98);
  let reminderHours = $state(24);
  let pace = $state<Pace>(DEFAULT_PACE);
  let prefs = $state<NotifyPrefs>({ ...DEFAULT_PREFS });
  let tgToken = $state('');
  let tgChat = $state('');
  let discordUrl = $state('');
  let status = $state('');
  let loaded = $state(false);

  $effect(() => {
    (async () => {
      threshold = Math.round((await repo.getSetting('threshold', DEFAULT_THRESHOLD)) * 100);
      reminderHours = await repo.getSetting('reminderHours', 24);
      pace = asPace(await repo.getSetting('pace', undefined));
      prefs = await loadPrefs();
      tgToken = prefs.telegram?.token ?? '';
      tgChat = prefs.telegram?.chatId ?? '';
      discordUrl = prefs.discord?.url ?? '';
      loaded = true;
    })();
  });

  // Must stay the first await of a click handler: Firefox only allows permissions.request
  // synchronously inside user input, and any earlier await loses that.
  async function save() {
    const origins: string[] = [];
    if (tgToken && tgChat) origins.push('https://api.telegram.org/*');
    if (discordUrl) origins.push(...discordOrigins(discordUrl));
    if (origins.length && !(await browser.permissions.request({ origins }))) {
      status = 'Permission for the notification service was denied.';
      return;
    }
    await repo.setSetting('threshold', Math.min(1, Math.max(0.5, threshold / 100)));
    await repo.setSetting('reminderHours', Math.max(0, reminderHours));
    await repo.setSetting('pace', pace);
    await savePrefs({
      ...prefs,
      telegram: tgToken && tgChat ? { token: tgToken.trim(), chatId: tgChat.trim() } : undefined,
      discord: discordUrl ? { url: discordUrl.trim() } : undefined,
    });
    status = 'Saved.';
  }

  function discordOrigins(url: string): string[] {
    try {
      const host = new URL(url).hostname;
      return host === 'discordapp.com' ? ['https://discordapp.com/*'] : ['https://discord.com/*'];
    } catch {
      return ['https://discord.com/*'];
    }
  }

  async function test(channel: 'browser' | 'telegram' | 'discord') {
    await save();
    const r = (await browser.runtime.sendMessage({ type: 'test-notify', channel })) as { ok: boolean; error?: string };
    status = r?.ok ? `${channel} test sent.` : `${channel} test failed: ${r?.error}`;
  }

  let diagnostics = $state('');
  async function copyDiagnostics() {
    const info = await buildDiagnostics(repo, ownerId, { version: browser.runtime.getManifest().version, userAgent: navigator.userAgent });
    diagnostics = JSON.stringify(info, null, 2);
    try {
      await navigator.clipboard.writeText(diagnostics);
      status = 'Diagnostics copied. Paste them into your bug report.';
    } catch {
      status = 'Could not copy automatically. Select the text below and copy it.';
    }
  }

  async function exportJson() {
    download(`ghosted-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await repo.exportAll()), 'application/json');
  }
  async function exportEvents() {
    if (!ownerId) return;
    const events = await repo.allEvents(ownerId);
    download('events.csv', toCsv(events.map((e) => ({ at: new Date(e.at).toISOString(), type: e.type, handle: e.handle, user_id: e.userId, reason: e.reason, previous_handle: e.previousHandle }))), 'text/csv');
  }
  async function importJson(ev: Event) {
    const file = (ev.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!confirm('Importing replaces ALL current data. Continue?')) return;
    try {
      await repo.importAll(JSON.parse(await file.text()));
      status = 'Imported.';
    } catch (e) {
      status = `Import failed: ${e}`;
    }
  }
  async function wipe() {
    if (confirm('Delete ALL stored history and lists? This cannot be undone.')) {
      await repo.wipe();
      status = 'All data deleted.';
    }
  }
</script>

<h2>Settings</h2>
{#if loaded}
  <section class="card grid">
    <h3>Scanning</h3>
    <label>Completeness threshold (% of expected count) <input type="number" min="50" max="100" bind:value={threshold} /></label>
    <label>Remind me to scan every (hours, 0 = never) <input type="number" min="0" bind:value={reminderHours} /></label>
    <label>
      Check speed
      <select bind:value={pace}>
        <option value="normal">Normal: fastest</option>
        <option value="careful">Careful: about 3× slower</option>
        <option value="slow">Slow: for very large accounts</option>
      </select>
    </label>
    <p class="muted">If X stops a check with a rate limit, choose a slower speed. Slower checks send X fewer requests per minute; they make limits less likely but cannot rule them out.</p>
  </section>

  <section class="card grid">
    <h3>Notifications</h3>
    <label><input type="checkbox" bind:checked={prefs.browser} /> Browser notifications</label>
    <label><input type="checkbox" bind:checked={prefs.newFollowers} /> Also notify about new followers</label>
    <label>Telegram bot token <input type="password" bind:value={tgToken} /></label>
    <label>Telegram chat id <input bind:value={tgChat} /></label>
    <label>Discord webhook URL <input type="password" bind:value={discordUrl} /></label>
    <p class="muted">Tokens are stored unencrypted in this browser profile only. They are sent solely to Telegram / Discord.</p>
    <div class="row">
      <button class="primary" onclick={save}>Save</button>
      <button onclick={() => test('browser')}>Test browser</button>
      <button onclick={() => test('telegram')} disabled={!tgToken || !tgChat}>Test Telegram</button>
      <button onclick={() => test('discord')} disabled={!discordUrl}>Test Discord</button>
    </div>
  </section>

  <section class="card grid">
    <h3>Data</h3>
    <div class="row" style="flex-wrap:wrap">
      <button onclick={exportJson}>Export JSON (full backup)</button>
      <button onclick={exportEvents} disabled={!ownerId}>Export events CSV</button>
      <label class="muted">Import JSON <input type="file" accept="application/json" onchange={importJson} /></label>
      <button class="danger" onclick={wipe}>Delete all data</button>
    </div>
  </section>
  <section class="card grid">
    <h3>Diagnostics</h3>
    <p class="muted">Something not adding up? Copy a short technical summary (no names or handles) to include in a bug report.</p>
    <div class="row"><button onclick={copyDiagnostics}>Copy diagnostics</button></div>
    {#if diagnostics}<textarea readonly rows="10" onfocus={(e) => e.currentTarget.select()}>{diagnostics}</textarea>{/if}
  </section>
  {#if status}<p class="warn">{status}</p>{/if}
{/if}

<style>
  .grid { display: grid; gap: 10px; }
  label { display: grid; gap: 4px; }
  textarea { width: 100%; font: 12px ui-monospace, monospace; color: var(--text); background: #ffffff0a; border: 1px solid var(--line); border-radius: 8px; padding: 8px; resize: vertical; }
  label:has(input[type='checkbox']) { display: flex; align-items: center; gap: 8px; }
</style>
