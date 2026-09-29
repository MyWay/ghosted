<script lang="ts">
  import { liveQuery } from 'dexie';
  import { repo } from '../../ui/repo';
  import type { MembershipRow, UserRow } from '../../db/schema';
  import Person from '../../ui/Person.svelte';
  import VirtualList from '../../ui/VirtualList.svelte';
  import { download, toCsv } from '../../ui/format';

  type Mode = 'not-following-back' | 'fans' | 'mutuals';
  let { ownerId, mode }: { ownerId: string; mode: Mode } = $props();
  type Row = MembershipRow & { user?: UserRow };

  const data = $derived(
    liveQuery(async () => {
      const [following, followers] = await Promise.all([repo.listMembers(ownerId, 'following'), repo.listMembers(ownerId, 'followers')]);
      return { following, followers };
    }),
  );

  const titles: Record<Mode, string> = { 'not-following-back': 'Not following back', fans: 'Fans (you do not follow back)', mutuals: 'Mutuals' };
  let query = $state('');
  let sort = $state<'name' | 'followers' | 'seen'>('name');
  let hideVerified = $state(false);
  let hideProtected = $state(false);

  const rows = $derived.by((): Row[] => {
    const d = $data;
    if (!d) return [];
    const followingIds = new Set(d.following.map((r) => r.userId));
    let list: Row[];
    if (mode === 'not-following-back') list = d.following.filter((r) => r.followsYou === false);
    else if (mode === 'fans') list = d.followers.filter((r) => !followingIds.has(r.userId));
    else list = d.following.filter((r) => r.followsYou === true);
    const q = query.trim().toLowerCase().replace(/^@/, '');
    list = list.filter(
      (r) =>
        (!q || r.handle.toLowerCase().includes(q) || (r.user?.name ?? '').toLowerCase().includes(q)) &&
        !(hideVerified && r.user?.isVerified) &&
        !(hideProtected && r.user?.isProtected),
    );
    return [...list].sort((a, b) =>
      sort === 'followers' ? (b.user?.followersCount ?? 0) - (a.user?.followersCount ?? 0)
      : sort === 'seen' ? (a.user?.firstSeenAt ?? 0) - (b.user?.firstSeenAt ?? 0)
      : a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' }),
    );
  });

  const missing = $derived(mode !== 'fans' && $data && $data.following.length === 0);
  const exportCsv = () =>
    download(`${mode}.csv`, toCsv(rows.map((r) => ({ id: r.userId, handle: r.handle, name: r.user?.name, followers: r.user?.followersCount, verified: r.user?.isVerified, protected: r.user?.isProtected }))), 'text/csv');
</script>

<h2>{titles[mode]}</h2>
{#if missing}
  <p class="muted">Scan your following list first.</p>
{:else if mode === 'fans' && $data && $data.followers.length === 0}
  <p class="muted">Scan your followers list first.</p>
{:else}
  <div class="row" style="flex-wrap:wrap">
    <input placeholder="Search name or @handle" bind:value={query} />
    <select bind:value={sort}>
      <option value="name">Sort: handle</option>
      <option value="followers">Sort: their followers</option>
      <option value="seen">Sort: first seen</option>
    </select>
    <label><input type="checkbox" bind:checked={hideVerified} /> hide verified</label>
    <label><input type="checkbox" bind:checked={hideProtected} /> hide protected</label>
    <span class="muted grow">{rows.length} accounts</span>
    <button onclick={exportCsv}>Export CSV</button>
  </div>
  {#if rows.length}
    <VirtualList items={rows} rowHeight={56} height={620}>
      {#snippet row(r)}
        <Person handle={r.handle} user={r.user} sub={r.user?.followersCount !== undefined ? `${r.user.followersCount.toLocaleString()} followers` : undefined} />
      {/snippet}
    </VirtualList>
  {:else}
    <p class="muted">Nothing here.</p>
  {/if}
{/if}
