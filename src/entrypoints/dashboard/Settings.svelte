<script lang="ts">
  import { browser } from 'wxt/browser';
  import { repo } from '../../ui/repo';
  import { download, timeAgo, toCsv } from '../../ui/format';
  import { loadNotifyErrors, loadPrefs, savePrefs, webhookAllowed, type Channel, type NotifyErrors } from '../../notify';
  import { DEFAULT_THRESHOLD } from '../../core/session';
  import { DEFAULT_PACE, asPace, type Pace } from '../../core/pace';
  import { buildDiagnostics } from '../../db/diagnostics';
  import { DEFAULT_PREFS, parseHeaders, templateError, webhookOrigin, type NotifyPrefs } from '../../notify/format';

  let { ownerId }: { ownerId?: string } = $props();

  let threshold = $state(98);
  let reminderHours = $state(24);
  let pace = $state<Pace>(DEFAULT_PACE);
  let prefs = $state<NotifyPrefs>({ ...DEFAULT_PREFS });
  let tgToken = $state('');
  let tgChat = $state('');
  let discordUrl = $state('');
  let webhookUrl = $state('');
  let webhookHeaders = $state('');
  let webhookTemplate = $state('');
  let webhookRevoked = $state(false);
  let notifyErrors = $state<NotifyErrors>({});
  const names: Record<Channel, string> = { browser: 'Browser', telegram: 'Telegram', discord: 'Discord', webhook: 'Webhook' };
  const badHeaders = $derived(parseHeaders(webhookHeaders).invalid);
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
      webhookUrl = prefs.webhook?.url ?? '';
      webhookHeaders = prefs.webhook?.headers ?? '';
      webhookTemplate = prefs.webhook?.template ?? '';
      webhookRevoked = !!prefs.webhook?.url && !(await webhookAllowed(prefs.webhook.url));
      notifyErrors = await loadNotifyErrors();
      loaded = true;
    })();
  });

  // Must stay the first await of a click handler: Firefox only allows permissions.request
  // synchronously inside user input, and any earlier await loses that.
  async function save() {
    const origins: string[] = [];
    if (tgToken && tgChat) origins.push('https://api.telegram.org/*');
    if (discordUrl) origins.push(...discordOrigins(discordUrl));
    if (webhookUrl.trim()) {
      const o = webhookOrigin(webhookUrl);
      if ('error' in o) {
        status = o.error;
        return;
      }
      const bodyError = templateError({ url: webhookUrl, headers: webhookHeaders, template: webhookTemplate });
      if (bodyError) {
        status = bodyError;
        return;
      }
      if (badHeaders.length) {
        status = `Webhook header lines need the form "Name: value": ${badHeaders.join(', ')}`;
        return;
      }
      origins.push(o.origin);
    }
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
      webhook: webhookUrl.trim() ? { url: webhookUrl.trim(), headers: webhookHeaders.trim() || undefined, template: webhookTemplate.trim() || undefined } : undefined,
    });
    webhookRevoked = false;
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

  async function test(channel: Channel) {
    await save();
    if (status !== 'Saved.') return;
    const r = (await browser.runtime.sendMessage({ type: 'test-notify', channel })) as { ok: boolean; error?: string };
    status = r?.ok ? `${names[channel]} test sent.` : `${names[channel]} test failed: ${r?.error}`;
    notifyErrors = await loadNotifyErrors();
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

{#snippet lastErrors(channels: Channel[])}
  {#each channels as c}
    {@const e = notifyErrors[c]}
    {#if e}<p class="bad">{names[c]} alert failed {timeAgo(e.at)}: {e.message}</p>{/if}
  {/each}
{/snippet}

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
    {@render lastErrors(['browser', 'telegram', 'discord'])}
    <div class="row">
      <button class="primary" onclick={save}>Save</button>
      <button onclick={() => test('browser')}>Test browser</button>
      <button onclick={() => test('telegram')} disabled={!tgToken || !tgChat}>Test Telegram</button>
      <button onclick={() => test('discord')} disabled={!discordUrl}>Test Discord</button>
    </div>
  </section>

  <section class="card grid">
    <h3>Webhook</h3>
    <p class="muted">Send each alert as a POST request to your own URL: n8n, Make, Zapier, Home Assistant, Slack, ntfy, or your own server. Plain http works only for localhost.</p>
    {@render lastErrors(['webhook'])}
    {#if webhookRevoked}<p class="bad">The browser no longer allows Ghosted to reach this URL. Press Save to allow it again.</p>{/if}
    <label>Webhook URL <input type="password" placeholder="https://…" bind:value={webhookUrl} /></label>
    <label>
      Headers (optional, one "Name: value" per line)
      <textarea rows="2" placeholder="Authorization: Bearer …" bind:value={webhookHeaders}></textarea>
      {#if badHeaders.length}<span class="bad">Not a valid header: {badHeaders.join(', ')}</span>{/if}
    </label>
    <label>
      Body (optional; empty sends the standard JSON)
      <textarea rows="3" placeholder={'{"text": "{{summary}}"}'} bind:value={webhookTemplate}></textarea>
    </label>
    <p class="muted">
      Placeholders: <code>{'{{summary}}'}</code> <code>{'{{count}}'}</code> <code>{'{{account}}'}</code> <code>{'{{at}}'}</code>
      <code>{'{{events}}'}</code> (JSON list) and <code>{'{{json}}'}</code> (the whole standard body). In a JSON body, text is escaped for
      use inside quotes. Set a <code>Content-Type</code> header to send plain text instead. Headers are stored unencrypted in this browser profile.
    </p>
    <div class="row">
      <button class="primary" onclick={save}>Save</button>
      <button onclick={() => test('webhook')} disabled={!webhookUrl.trim()}>Send test</button>
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
  code { font-size: 12px; }
  label:has(input[type='checkbox']) { display: flex; align-items: center; gap: 8px; }
</style>
