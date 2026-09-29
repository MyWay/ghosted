<script lang="ts">
  import { browser } from 'wxt/browser';
  import { repo } from '../../ui/repo';
  import { download, toCsv } from '../../ui/format';
  import { loadPrefs, savePrefs } from '../../notify';
  import { DEFAULT_PREFS, type NotifyPrefs } from '../../notify/format';

  let { ownerId }: { ownerId?: string } = $props();

  let threshold = $state(98);
  let reminderHours = $state(24);
  let prefs = $state<NotifyPrefs>({ ...DEFAULT_PREFS });
  let tgToken = $state('');
  let tgChat = $state('');
  let discordUrl = $state('');
  let status = $state('');
  let loaded = $state(false);

  $effect(() => {
    (async () => {
      threshold = Math.round((await repo.getSetting('threshold', 0.98)) * 100);
      reminderHours = await repo.getSetting('reminderHours', 24);
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
  {#if status}<p class="warn">{status}</p>{/if}
{/if}

<style>
  .grid { display: grid; gap: 10px; }
  label { display: grid; gap: 4px; }
  label:has(input[type='checkbox']) { display: flex; align-items: center; gap: 8px; }
</style>
