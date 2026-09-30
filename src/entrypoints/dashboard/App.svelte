<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from 'wxt/browser';
  import type { ComponentProps } from 'svelte';
  import { repo } from '../../ui/repo';
  import Icon from '../../ui/Icon.svelte';
  import { FOLLOW_URL, followPromptDone, markFollowPromptDone } from '../../ui/follow';
  import Overview from './Overview.svelte';
  import Timeline from './Timeline.svelte';
  import Lists from './Lists.svelte';
  import Scans from './Scans.svelte';
  import Settings from './Settings.svelte';

  type Tab = 'overview' | 'timeline' | 'not-following-back' | 'fans' | 'mutuals' | 'scans' | 'settings';
  const tabs: Array<[Tab, string, ComponentProps<typeof Icon>['name']]> = [
    ['overview', 'Overview', 'overview'],
    ['timeline', 'Timeline', 'timeline'],
    ['not-following-back', 'Not following back', 'userx'],
    ['fans', 'Fans', 'users'],
    ['mutuals', 'Mutuals', 'heart'],
    ['scans', 'Scans', 'scans'],
    ['settings', 'Settings', 'settings'],
  ];
  const isTab = (t: string): t is Tab => tabs.some(([id]) => id === t);
  let tab = $state<Tab>(isTab(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : 'overview');
  $effect(() => {
    if (location.hash.slice(1) !== tab) location.hash = tab;
  });
  $effect(() => {
    const onHash = () => {
      const h = location.hash.slice(1);
      if (isTab(h) && h !== tab) tab = h;
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });
  const go = (t: string) => {
    if (isTab(t)) tab = t;
  };

  const owner = liveQuery(async () => {
    const ownerId = await repo.getSetting<string | undefined>('ownerId', undefined);
    const handle = await repo.getSetting<string | undefined>('ownerHandle', undefined);
    const me = ownerId && handle ? await repo.db.users.where('handle').equals(handle).first() : undefined;
    return { ownerId, handle, avatar: me?.avatarUrl };
  });
</script>

<div class="shell">
  <nav>
    <div class="brand">
      <img class="logo" src="/icon/logo.svg" alt="" />
      <strong>Ghosted</strong>
    </div>
    {#if $owner?.handle}
      <a class="me row" href="https://x.com/{$owner.handle}" target="_blank" rel="noopener">
        {#if $owner.avatar}<img class="avatar" src={$owner.avatar} alt="" />{:else}<span class="avatar"></span>{/if}
        <span class="ellipsis">@{$owner.handle}</span>
      </a>
    {/if}
    <div class="links">
      {#each tabs as [id, label, icon]}
        <button class:active={tab === id} onclick={() => (tab = id)} aria-current={tab === id ? 'page' : undefined}>
          <Icon name={icon} size={17} /><span>{label}</span>
        </button>
      {/each}
    </div>
    <div class="foot muted">
      {#if $owner?.ownerId && $followPromptDone === false}
        <div class="follow">
          <p>Found Ghosted useful? <a href={FOLLOW_URL} target="_blank" rel="noopener" onclick={markFollowPromptDone}>Follow @stackway24 for updates</a></p>
          <button class="x" aria-label="Dismiss" title="Dismiss" onclick={markFollowPromptDone}>×</button>
        </div>
      {/if}
      <p>Local only · no servers</p>
    </div>
  </nav>
  <main>
    {#if !$owner}
      <!-- loading -->
    {:else if !$owner.ownerId && tab !== 'settings'}
      <div class="card onboard">
        <h2>Let's get you set up</h2>
        <p class="muted">No X account detected yet. The setup guide walks you through it in under a minute.</p>
        <button class="primary" onclick={() => browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') })}>Open setup guide</button>
      </div>
    {:else if tab === 'settings'}
      <Settings ownerId={$owner.ownerId} />
    {:else if $owner.ownerId}
      {#if tab === 'overview'}<Overview ownerId={$owner.ownerId} {go} />
      {:else if tab === 'timeline'}<Timeline ownerId={$owner.ownerId} />
      {:else if tab === 'not-following-back'}<Lists ownerId={$owner.ownerId} mode="not-following-back" />
      {:else if tab === 'fans'}<Lists ownerId={$owner.ownerId} mode="fans" />
      {:else if tab === 'mutuals'}<Lists ownerId={$owner.ownerId} mode="mutuals" />
      {:else if tab === 'scans'}<Scans ownerId={$owner.ownerId} />{/if}
    {/if}
  </main>
</div>

<style>
  .shell { display: grid; grid-template-columns: 236px 1fr; min-height: 100vh; }
  nav {
    padding: 20px 14px; border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 16px;
    background: linear-gradient(180deg, #1c1b18, #161614); position: sticky; top: 0; height: 100vh;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-family: Georgia, serif; font-size: 18px; color: var(--amber); padding: 0 6px; }
  .logo { width: 26px; height: 26px; filter: drop-shadow(0 2px 8px #e0a33a44); }
  .me { padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: #ffffff08; color: var(--text); }
  .me:hover { text-decoration: none; border-color: #62d6d066; }
  .me .avatar { width: 30px; height: 30px; }
  .links { display: grid; gap: 2px; }
  .links button { display: flex; align-items: center; gap: 10px; text-align: left; border-color: transparent; background: transparent; color: var(--muted); padding: 8px 10px; }
  .links button:hover { color: var(--text); background: #ffffff0d; }
  .links button.active { background: #e0a33a1f; color: var(--amber); font-weight: 650; }
  .foot { margin-top: auto; font-size: 12px; padding: 0 6px; display: grid; gap: 4px; }
  .foot p { margin: 0; }
  .follow { display: flex; align-items: flex-start; gap: 6px; }
  .follow .x { background: none; border: 0; color: var(--muted); font-size: 18px; line-height: 1; padding: 0 4px; margin-top: -2px; }
  .follow .x:hover { color: var(--text); background: none; }
  main { padding: 28px 36px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-content: start; min-width: 0; max-width: 1200px; }
  .onboard { display: grid; gap: 10px; justify-items: start; padding: 28px; }
  @media (max-width: 760px) {
    .shell { grid-template-columns: minmax(0, 1fr); }
    nav { position: static; height: auto; min-width: 0; }
    .links { grid-auto-flow: column; justify-content: start; overflow-x: auto; min-width: 0; scrollbar-width: none; }
    .links span { white-space: nowrap; }
    .foot { display: none; }
    main { padding: 16px; }
  }
</style>
