<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from 'wxt/browser';
  import { repo } from '../../ui/repo';
  import { eventLabel, eventTone, profileUrl, timeAgo } from '../../ui/format';
  import { hasXAccess, requestXAccess } from '../../ui/access';
  import { compact, totals } from '../../ui/stats';
  import { refreshBadge, seenKey } from '../../notify/badge';
  import type { EventRow } from '../../db/schema';
  import Icon from '../../ui/Icon.svelte';

  /** Events newer than this id are "new": captured once when the popup opens, then marked seen. */
  let seenAtOpen = $state<number | null>(null);

  const view = liveQuery(async () => {
    const ownerId = await repo.getSetting<string | undefined>('ownerId', undefined);
    if (!ownerId) return null;
    const [handle, health, following, followers, events, scans, followingRows, followerRows] = await Promise.all([
      repo.getSetting<string | undefined>('ownerHandle', undefined),
      repo.getSetting<Record<string, any>>('health', {}),
      repo.lastCommit(ownerId, 'following'),
      repo.lastCommit(ownerId, 'followers'),
      repo.recentEvents(ownerId, 8),
      repo.listScans(ownerId, 20),
      repo.listMembers(ownerId, 'following'),
      repo.listMembers(ownerId, 'followers'),
    ]);
    const lastChecked = Math.max(following?.endedAt ?? 0, followers?.endedAt ?? 0) || undefined;
    return {
      ownerId,
      handle,
      health,
      baselineDone: !!following && !!followers,
      lastChecked,
      events,
      review: scans.filter((s) => s.status === 'needs_review').length,
      t: totals(followingRows, followerRows),
    };
  });

  // Opening the popup marks everything as seen and clears the toolbar badge.
  $effect(() => {
    void (async () => {
      const ownerId = await repo.getSetting<string | undefined>('ownerId', undefined);
      if (!ownerId) return (seenAtOpen = 0);
      const seen = await repo.getSetting(seenKey(ownerId), 0);
      seenAtOpen = seen;
      const max = await repo.maxEventId(ownerId);
      if (max > seen) await repo.setSetting(seenKey(ownerId), max);
      await refreshBadge(repo);
    })();
  });

  let access = $state(true);
  $effect(() => {
    void hasXAccess().then((a) => (access = a));
  });
  async function grant() {
    access = await requestXAccess();
  }

  let error = $state('');
  let busy = $state(false);
  async function check() {
    busy = true;
    error = '';
    const r = (await browser.runtime.sendMessage({ type: 'start-scan', kinds: ['following', 'followers'] })) as { ok: boolean; error?: string };
    busy = false;
    if (!r?.ok) error = r?.error ?? 'Could not start the check.';
    else window.close();
  }

  const open = async (path: '/dashboard.html' | '/welcome.html') => {
    await browser.tabs.create({ url: browser.runtime.getURL(path) });
    window.close();
  };

  const isNew = (e: EventRow) => seenAtOpen !== null && (e.id ?? 0) > seenAtOpen;
  const arrow = (e: EventRow) =>
    e.type === 'NEW_FOLLOWER' || e.type === 'NEW_MUTUAL' || e.type === 'NEW_FOLLOWING' ? 'up' : e.type === 'RENAME' ? 'minus' : 'down';
  const health = (h: Record<string, any>) =>
    h.lastParseError ? { color: 'var(--rose)', text: 'X changed something; checks are paused until an update' }
    : h.lastRateLimitAt && Date.now() - h.lastRateLimitAt < 3_600_000 ? { color: 'var(--amber)', text: 'X is rate-limiting, try again later' }
    : null;
</script>

<main>
  <header class="row">
    <img class="logo" src="/icon/logo.svg" alt="" />
    <h1 class="grow">Ghosted</h1>
    {#if $view?.handle}<span class="muted">@{$view.handle}</span>{/if}
  </header>

  {#if !access}
    <div class="card warnbox">
      <strong class="warn">No access to x.com</strong>
      <p class="muted">Your browser needs your OK before Ghosted can see your follower lists.</p>
      <button class="primary" onclick={grant}>Allow access</button>
    </div>
  {/if}

  {#if !$view}
    <div class="card hero">
      <p>Find out who unfollows you on X.</p>
      <p class="muted">Setup takes under a minute.</p>
      <button class="primary big" onclick={() => open('/welcome.html')}>Get started</button>
    </div>
  {:else}
    {@const s = $view}
    {@const h = health(s.health)}
    {#if h}<div class="row small"><span class="dot" style="background:{h.color}"></span><span class="grow">{h.text}</span></div>{/if}

    <div class="totals muted tabular">
      <span><strong>{s.baselineDone ? compact(s.t.followers) : '—'}</strong> followers</span>
      <span><strong>{s.baselineDone ? compact(s.t.following) : '—'}</strong> following</span>
      <span><strong>{s.baselineDone ? compact(s.t.notFollowingBack) : '—'}</strong> don't follow back</span>
    </div>

    <button class="primary big" onclick={check} disabled={busy}>
      <Icon name="scan" size={16} />{busy ? 'Starting…' : 'Check now'}
    </button>
    <p class="muted small center">Last checked {timeAgo(s.lastChecked)}</p>
    {#if error}<p class="bad small">{error}</p>{/if}
    {#if s.review}<button class="card notice" onclick={() => open('/dashboard.html')}><span class="warn">A check needs your review</span> <span class="muted">→ dashboard</span></button>{/if}

    <section>
      {#if s.events.length}
        {@const fresh = s.events.filter(isNew).length}
        <h3>Changes {#if fresh}<span class="badge new">{fresh} new</span>{/if}</h3>
        {#each s.events as e (e.id)}
          <a class="ev row" class:unseen={isNew(e)} href={profileUrl(e.handle)} target="_blank" rel="noopener">
            <span class="kind {eventTone(e)}"><Icon name={arrow(e)} size={13} /></span>
            <span class="grow ellipsis"><strong>@{e.handle}</strong> <span class="muted">{eventLabel(e)}</span></span>
            <span class="muted small">{timeAgo(e.at)}</span>
          </a>
        {/each}
      {:else if s.baselineDone}
        <div class="card allset">
          <strong class="good">All set</strong>
          <p class="muted">Tracking {s.t.followers.toLocaleString()} followers and {s.t.following.toLocaleString()} following. Changes show up here after your next check.</p>
        </div>
      {:else}
        <div class="card allset">
          <strong>One more step</strong>
          <p class="muted">Press <em>Check now</em> to record who follows you today. Keep the X tab visible until it says done.</p>
        </div>
      {/if}
    </section>
  {/if}

  <button class="link" onclick={() => open('/dashboard.html')}>Open dashboard →</button>
</main>

<style>
  main { width: 360px; padding: 14px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .logo { width: 26px; height: 26px; }
  h1 { font-size: 20px; }
  h3 { font-size: 13px; margin: 4px 0 2px; font-family: inherit; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .small { font-size: 12px; }
  .center { text-align: center; margin: -4px 0 0; }
  .big { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; font-size: 15px; width: 100%; }
  .totals { display: grid; grid-template-columns: repeat(3, auto); justify-content: space-between; gap: 4px 8px; font-size: 12px; }
  header .muted { max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .totals strong { color: var(--text); font-size: 14px; }
  .warnbox { display: grid; gap: 6px; border-color: #e0a33a66; }
  .warnbox p, .allset p, .hero p { margin: 0; }
  .hero, .allset { display: grid; gap: 6px; }
  .notice { font: inherit; text-align: left; cursor: pointer; }
  .ev { padding: 6px 4px; border-bottom: 1px solid var(--line); color: var(--text); border-radius: 6px; }
  .ev:hover { background: #ffffff0a; text-decoration: none; }
  .ev.unseen { background: #e0a33a14; }
  .kind { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: #ffffff0d; flex-shrink: 0; }
  .new { color: var(--amber); border-color: #e0a33a66; }
  .link { background: none; border: 0; color: var(--cyan); padding: 2px; justify-self: center; }
</style>
