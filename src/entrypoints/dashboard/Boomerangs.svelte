<script lang="ts">
  import { liveQuery } from 'dexie';
  import { repo } from '../../ui/repo';
  import { cycleBadge, findBoomerangs, MIN_CYCLES } from '../../core/follows';
  import { download, profileUrl, timeAgo, toCsv } from '../../ui/format';
  import Person from '../../ui/Person.svelte';

  let { ownerId }: { ownerId: string } = $props();

  const data = $derived(
    liveQuery(async () => {
      const [events, followers, users] = await Promise.all([
        repo.allEvents(ownerId),
        repo.listMembers(ownerId, 'followers'),
        repo.db.users.where('ownerId').equals(ownerId).toArray(),
      ]);
      return {
        boomerangs: findBoomerangs(events),
        followerIds: new Set(followers.map((f) => f.userId)),
        users: new Map(users.map((u) => [u.id, u])),
      };
    }),
  );

  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const exportCsv = () =>
    download(
      'boomerangs.csv',
      toCsv(($data?.boomerangs ?? []).map((s) => ({ id: s.userId, handle: s.handle, times_unfollowed: s.cycles, last_left: new Date(s.lastLeftAt).toISOString(), follows_you: $data!.followerIds.has(s.userId) }))),
      'text/csv',
    );
</script>

<h2>Boomerangs</h2>
<p class="muted note">
  People who unfollowed you {MIN_CYCLES} or more times. Ghosted only sees changes between your checks, so a follow and
  unfollow in between is missed and the real count may be higher. Suspended or deleted accounts don't count.
</p>

{#if $data}
  {#if $data.boomerangs.length}
    <div class="row">
      <span class="muted grow">{$data.boomerangs.length} accounts</span>
      <button onclick={exportCsv}>Export CSV</button>
    </div>
    <div class="card list">
      {#each $data.boomerangs as s (s.userId)}
        {@const b = cycleBadge(s.cycles)!}
        {@const follows = $data.followerIds.has(s.userId)}
        <details class="item">
          <summary class="row">
            <div class="grow"><Person handle={s.handle} user={$data.users.get(s.userId)} sub="unfollowed you {s.cycles}× · last {timeAgo(s.lastLeftAt)}" /></div>
            <span class="muted state">{follows ? 'follows you now' : 'not following'}</span>
            <span class="badge {b.tier}">{b.emoji} {b.label}</span>
          </summary>
          <div class="history muted">
            {#each s.history as h, i}
              {#if i}<span aria-hidden="true">→</span>{/if}
              <span class={h.change === 'loss' ? 'bad' : 'good'}>{h.change === 'loss' ? 'left' : 'followed'} {day(h.at)}</span>
            {/each}
            <a href={profileUrl(s.handle)} target="_blank" rel="noopener">Open profile to block or mute</a>
          </div>
        </details>
      {/each}
    </div>
  {:else}
    <p class="muted">Nobody yet. Someone shows up here after unfollowing you a second time.</p>
  {/if}
{/if}

<style>
  .note { margin: 0; max-width: 70ch; font-size: 13px; }
  .list { padding: 0 12px; }
  .item { border-bottom: 1px solid var(--line); }
  .item:last-child { border-bottom: 0; }
  summary { padding: 8px 0; cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  .state { font-size: 12px; white-space: nowrap; }
  .history { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; padding: 0 0 10px 46px; font-size: 12px; }
  .history a { margin-left: auto; }
  @media (max-width: 760px) { .state { display: none; } .history { padding-left: 0; } }
</style>
