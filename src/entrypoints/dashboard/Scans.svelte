<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from 'wxt/browser';
  import { repo } from '../../ui/repo';
  import { timeAgo } from '../../ui/format';

  let { ownerId }: { ownerId: string } = $props();
  const scans = $derived(liveQuery(() => repo.listScans(ownerId, 100)));

  const tone = (s: string) => (s === 'committed' ? 'good' : s === 'needs_review' ? 'warn' : s === 'invalid' || s === 'rejected' ? 'bad' : 'muted');

  let startError = $state('');
  async function start(kinds: Array<'following' | 'followers'>) {
    startError = '';
    const r = (await browser.runtime.sendMessage({ type: 'start-scan', kinds })) as { ok: boolean; error?: string };
    if (!r?.ok) startError = r?.error ?? 'Could not start the check.';
  }

  async function resolve(scanId: number, accept: boolean) {
    await browser.runtime.sendMessage({ type: 'resolve-review', scanId, accept });
  }
</script>

<div class="row" style="flex-wrap:wrap">
  <h2 class="grow">Scans</h2>
  <button onclick={() => start(['following'])}>Check following only</button>
  <button onclick={() => start(['followers'])}>Check followers only</button>
</div>
{#if startError}<p class="bad">{startError}</p>{/if}
{#each $scans ?? [] as s (s.scanId)}
  <div class="card">
    <div class="row">
      <strong>{s.kind}</strong>
      <span class="badge {tone(s.status)}">{s.status.replace('_', ' ')}</span>
      <span class="grow muted">{timeAgo(s.startedAt)} · {s.collected}{s.expected ? ` of ~${s.expected}` : ''} collected{s.state.unavailable ? ` + ${s.state.unavailable} unavailable` : ''} · {s.state.pages} pages</span>
    </div>
    {#if s.reason}<div class="muted">{s.reason}</div>{/if}
    {#if s.status === 'needs_review'}
      <p class="warn">This scan would remove {s.pendingRemoved} accounts, more than the safety limit allows when your profile's follower count wasn't available to check against. The list itself was read to the end ({s.state.pages} pages, no gaps). Compare "collected" with your follower count on X: a gap of a few percent is normal, because suspended and deactivated accounts count but aren't listed. Nothing has been applied.</p>
      <div class="row">
        <button class="danger" onclick={() => resolve(s.scanId!, true)}>Apply changes</button>
        <button onclick={() => resolve(s.scanId!, false)}>Discard scan</button>
      </div>
    {/if}
  </div>
{:else}
  <p class="muted">No scans yet.</p>
{/each}
