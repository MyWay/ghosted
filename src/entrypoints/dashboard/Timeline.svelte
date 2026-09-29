<script lang="ts">
  import { liveQuery } from 'dexie';
  import { repo } from '../../ui/repo';
  import { eventLabel, eventTone, profileUrl, timeAgo } from '../../ui/format';
  import type { EventType } from '../../core/types';
  import VirtualList from '../../ui/VirtualList.svelte';
  import Icon from '../../ui/Icon.svelte';

  let { ownerId }: { ownerId: string } = $props();
  const events = $derived(liveQuery(() => repo.allEvents(ownerId)));
  const users = $derived(liveQuery(async () => new Map((await repo.db.users.where('ownerId').equals(ownerId).toArray()).map((u) => [u.id, u]))));
  const icon = (t: EventType) =>
    t === 'NEW_FOLLOWER' || t === 'NEW_MUTUAL' || t === 'NEW_FOLLOWING' ? 'up' : t === 'RENAME' ? 'minus' : 'down';

  let type = $state<'all' | EventType>('all');
  let query = $state('');
  let from = $state('');
  let to = $state('');

  const types: EventType[] = ['LOST_FOLLOWER', 'NEW_FOLLOWER', 'LOST_MUTUAL', 'NEW_MUTUAL', 'UNFOLLOWED_BY_ME', 'NEW_FOLLOWING', 'RENAME'];
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    const f = from ? new Date(from).getTime() : 0;
    const t = to ? new Date(to).getTime() + 86_400_000 : Infinity;
    return ($events ?? []).filter(
      (e) => (type === 'all' || e.type === type) && e.at >= f && e.at < t && (!q || e.handle.toLowerCase().includes(q) || (e.previousHandle ?? '').toLowerCase().includes(q)),
    );
  });
</script>

<h2>Timeline</h2>
<div class="row" style="flex-wrap:wrap">
  <select bind:value={type}>
    <option value="all">All events</option>
    {#each types as t}<option value={t}>{t.replaceAll('_', ' ').toLowerCase()}</option>{/each}
  </select>
  <input placeholder="Search @handle" bind:value={query} />
  <label class="muted">from <input type="date" bind:value={from} /></label>
  <label class="muted">to <input type="date" bind:value={to} /></label>
  <span class="muted">{filtered.length} events</span>
</div>

{#if filtered.length}
  <VirtualList items={filtered} rowHeight={58} height={640}>
    {#snippet row(e)}
      {@const u = $users?.get(e.userId)}
      <div class="row">
        <span class="kind {eventTone(e)}"><Icon name={icon(e.type)} size={14} /></span>
        {#if u?.avatarUrl}<img class="avatar" src={u.avatarUrl} alt="" loading="lazy" />{:else}<span class="avatar"></span>{/if}
        <div class="grow">
          <div class="ellipsis"><strong>{u?.name || e.handle}</strong> <a href={profileUrl(e.handle)} target="_blank" rel="noopener">@{e.handle}</a></div>
          <div class="ellipsis muted">{eventLabel(e)}</div>
        </div>
        <span class="muted" title={new Date(e.at).toLocaleString()}>{timeAgo(e.at)}</span>
      </div>
    {/snippet}
  </VirtualList>
{:else}
  <p class="muted">No events match. The first scan of each list is a baseline and produces none.</p>
{/if}

<style>
  .kind { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: #ffffff0d; flex-shrink: 0; }
</style>
