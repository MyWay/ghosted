<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from 'wxt/browser';
  import { repo } from '../../ui/repo';
  import { countSeries, dailyChanges, delta, listGap, totals } from '../../ui/stats';
  import { eventLabel, timeAgo } from '../../ui/format';
  import { withoutRepeats } from '../../core/follows';
  import StatTile from '../../ui/StatTile.svelte';
  import LineChart from '../../ui/LineChart.svelte';
  import DivergingBars from '../../ui/DivergingBars.svelte';
  import Person from '../../ui/Person.svelte';
  import Icon from '../../ui/Icon.svelte';

  let { ownerId, go }: { ownerId: string; go: (tab: string) => void } = $props();
  const WEEK = 7 * 86_400_000;

  const data = $derived(
    liveQuery(async () => {
      const [following, followers, scans, events, users] = await Promise.all([
        repo.listMembers(ownerId, 'following'),
        repo.listMembers(ownerId, 'followers'),
        repo.listScans(ownerId, 500),
        repo.allEvents(ownerId),
        repo.db.users.where('ownerId').equals(ownerId).toArray(),
      ]);
      return { following, followers, scans, events, users: new Map(users.map((u) => [u.id, u])) };
    }),
  );

  let range = $state<14 | 30 | 90>(30);
  let busy = $state(false);
  let scanError = $state('');

  const view = $derived.by(() => {
    const d = $data;
    if (!d) return null;
    const now = Date.now();
    const followerSeries = countSeries(d.scans, 'followers');
    const followingSeries = countSeries(d.scans, 'following');
    return {
      t: totals(d.following, d.followers),
      hasFollowers: followerSeries.length > 0,
      hasFollowing: followingSeries.length > 0,
      followerSeries,
      followersDelta: delta(followerSeries, WEEK, now),
      followingDelta: delta(followingSeries, WEEK, now),
      days: dailyChanges(d.events, range, now),
      departures: withoutRepeats(d.events.filter((e) => e.type === 'LOST_FOLLOWER' || e.type === 'LOST_MUTUAL'), d.events).slice(0, 8),
      lastScan: d.scans.find((s) => s.status === 'committed'),
      followersGap: listGap(d.scans.find((s) => s.kind === 'followers' && s.status === 'committed')),
      review: d.scans.filter((s) => s.status === 'needs_review').length,
      users: d.users,
    };
  });

  async function scanBoth() {
    busy = true;
    scanError = '';
    const r = (await browser.runtime.sendMessage({ type: 'start-scan', kinds: ['following', 'followers'] })) as { ok: boolean; error?: string };
    busy = false;
    if (!r?.ok) scanError = r?.error ?? 'Could not start the scan.';
  }
</script>

{#if view}
  {@const v = view}
  <header class="row head">
    <div class="grow">
      <h2>Overview</h2>
      <p class="muted">Last scan {timeAgo(v.lastScan?.endedAt)}{#if v.lastScan} · {v.lastScan.kind}{/if}</p>
    </div>
    <button class="primary row" onclick={scanBoth} disabled={busy}><Icon name="scan" size={16} /> Check now</button>
  </header>
  {#if scanError}<p class="bad">{scanError}</p>{/if}
  {#if v.review}<button class="card notice" onclick={() => go('scans')}><strong class="warn">{v.review} scan(s) need your review</strong> <span class="muted">— nothing was applied yet. Open Scans →</span></button>{/if}

  <section class="tiles">
    <StatTile
      hero
      label="Followers"
      value={v.hasFollowers ? v.t.followers : undefined}
      delta={v.followersDelta}
      note={v.followersGap ? `X shows ${v.followersGap.xCount.toLocaleString()}` : undefined}
      noteTitle={v.followersGap ? `X counts ${v.followersGap.gap} account${v.followersGap.gap === 1 ? '' : 's'} it doesn't include in the list (usually suspended or deactivated). Ghosted can only see the list.` : undefined}
    />
    <div class="small-tiles">
      <StatTile label="Following" value={v.hasFollowing ? v.t.following : undefined} delta={v.followingDelta} />
      <StatTile label="Mutuals" value={v.hasFollowing ? v.t.mutuals : undefined} onclick={() => go('mutuals')} />
      <StatTile label="Not following back" value={v.hasFollowing ? v.t.notFollowingBack : undefined} onclick={() => go('not-following-back')} />
      <StatTile label="Fans" value={v.hasFollowers && v.hasFollowing ? v.t.fans : undefined} onclick={() => go('fans')} />
    </div>
  </section>

  <section class="grid2">
    <div class="card chart">
      <div class="row"><h3 class="grow">Followers over time</h3></div>
      {#if v.followerSeries.length >= 2}
        <LineChart points={v.followerSeries} label="Followers" />
      {:else}
        <p class="muted empty">Appears after your second followers scan.</p>
      {/if}
    </div>
    <div class="card chart">
      <div class="row">
        <h3 class="grow">Gained vs lost</h3>
        <select bind:value={range} aria-label="Range">
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      <DivergingBars days={v.days} />
    </div>
  </section>

  <section class="card">
    <div class="row"><h3 class="grow">Recent departures</h3><button class="link" onclick={() => go('timeline')}>Full timeline →</button></div>
    {#each v.departures as e (e.id)}
      <div class="dep row">
        <div class="grow"><Person handle={e.handle} user={v.users.get(e.userId)} sub={eventLabel(e)} /></div>
        <span class="muted">{timeAgo(e.at)}</span>
      </div>
    {:else}
      <p class="muted">Nobody has left yet{v.hasFollowers ? '' : ' — run your first scan to start tracking'}.</p>
    {/each}
  </section>
{/if}

<style>
  .head h2 { font-size: 26px; }
  .head p { margin: 2px 0 0; }
  .notice { text-align: left; font: inherit; color: inherit; cursor: pointer; }
  .tiles { display: grid; grid-template-columns: minmax(220px, 1fr) 2fr; gap: 12px; }
  .small-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); gap: 12px; }
  .chart { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-width: 0; align-content: start; }
  .empty { min-height: 160px; display: grid; place-items: center; margin: 0; }
  h3 { font-size: 16px; }
  .dep { padding: 8px 0; border-bottom: 1px solid var(--line); }
  .dep:last-child { border-bottom: 0; }
  .link { background: none; border: 0; color: var(--cyan); padding: 0; }
  @media (max-width: 760px) { .tiles { grid-template-columns: minmax(0, 1fr); } .head h2 { font-size: 22px; } }
</style>
