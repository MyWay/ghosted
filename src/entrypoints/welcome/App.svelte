<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from 'wxt/browser';
  import { repo } from '../../ui/repo';
  import { hasXAccess, requestXAccess } from '../../ui/access';
  import Icon from '../../ui/Icon.svelte';
  import { FOLLOW_HANDLE, FOLLOW_URL, followPromptDone, markFollowPromptDone } from '../../ui/follow';

  let access = $state<boolean | null>(null);
  let scanError = $state('');
  let starting = $state(false);

  const refreshAccess = async () => (access = await hasXAccess());
  $effect(() => {
    void refreshAccess();
    const onChange = () => void refreshAccess();
    browser.permissions.onAdded.addListener(onChange);
    browser.permissions.onRemoved.addListener(onChange);
    return () => {
      browser.permissions.onAdded.removeListener(onChange);
      browser.permissions.onRemoved.removeListener(onChange);
    };
  });

  const progress = liveQuery(async () => {
    const ownerId = await repo.getSetting<string | undefined>('ownerId', undefined);
    const handle = await repo.getSetting<string | undefined>('ownerHandle', undefined);
    if (!ownerId) return { ownerId, handle, following: false, followers: false };
    const [following, followers] = await Promise.all([repo.lastCommit(ownerId, 'following'), repo.lastCommit(ownerId, 'followers')]);
    return { ownerId, handle, following: !!following, followers: !!followers };
  });

  const loggedIn = $derived(!!$progress?.handle);
  const scanned = $derived(!!$progress?.following && !!$progress?.followers);
  const step = $derived(!access ? 1 : !loggedIn ? 2 : !scanned ? 3 : 4);

  async function grant() {
    // First await of the click handler: required by Firefox.
    await requestXAccess();
    await refreshAccess();
  }

  async function firstScan() {
    starting = true;
    scanError = '';
    const r = (await browser.runtime.sendMessage({ type: 'start-scan', kinds: ['following', 'followers'] })) as { ok: boolean; error?: string };
    starting = false;
    if (!r?.ok) scanError = r?.error ?? 'Could not start the scan.';
  }

  const openDashboard = () => (location.href = browser.runtime.getURL('/dashboard.html'));
</script>

<main>
  <header>
    <img class="logo" src="/icon/logo.svg" alt="" />
    <h1>Know who unfollows you on X.</h1>
    <p class="muted lead">
      Ghosted watches the follower lists X already loads in your browser and tells you what changed. No account, no server, no
      API keys: everything stays on this computer.
    </p>
  </header>

  <ol class="steps">
    <li class="card" class:done={access} class:current={step === 1}>
      <span class="num">{#if access}<Icon name="check" size={16} />{:else}1{/if}</span>
      <div class="grow">
        <h3>Allow access to x.com</h3>
        {#if access}
          <p class="muted">Granted. The extension can read your follower lists on x.com, and only there.</p>
        {:else}
          <p class="muted">Your browser asks you to confirm this. It is only used to observe x.com pages you open.</p>
          <button class="primary" onclick={grant}>Allow access to x.com</button>
        {/if}
      </div>
    </li>

    <li class="card" class:done={loggedIn} class:current={step === 2}>
      <span class="num">{#if loggedIn}<Icon name="check" size={16} />{:else}2{/if}</span>
      <div class="grow">
        <h3>Open X while logged in</h3>
        {#if loggedIn}
          <p class="muted">Found you: <strong>@{$progress?.handle}</strong></p>
        {:else}
          <p class="muted">Open x.com in this browser and make sure you are logged in. This step completes on its own.</p>
          <button class="primary" disabled={!access} onclick={() => browser.tabs.create({ url: 'https://x.com/home' })}>Open x.com</button>
        {/if}
      </div>
    </li>

    <li class="card" class:done={scanned} class:current={step === 3}>
      <span class="num">{#if scanned}<Icon name="check" size={16} />{:else}3{/if}</span>
      <div class="grow">
        <h3>Run your first check</h3>
        {#if scanned}
          <p class="muted">Done. From now on, every check is compared with the previous one.</p>
        {:else}
          <p class="muted">
            Opens your following, then followers list and scrolls them for you. Keep that tab visible until the panel says
            <em>Check complete</em>. This first check records who follows you today; changes show up from the next one.
          </p>
          <button class="primary" disabled={!loggedIn || starting} onclick={firstScan}>Start first check</button>
          {#if $progress?.following && !$progress.followers}<p class="warn">Following done, followers still missing.</p>{/if}
          {#if scanError}<p class="bad">{scanError}</p>{/if}
        {/if}
      </div>
    </li>
  </ol>

  <section class="card tips">
    <h3>Good to know</h3>
    <ul class="muted">
      <li>Nothing updates on its own: press <em>Check now</em> in the popup, or click the daily reminder.</li>
      <li>Scrolling your own followers page to the bottom also counts as a check.</li>
      <li>Want alerts on your phone? Add Telegram or Discord in Settings.</li>
      <li>Pin the extension to your toolbar (puzzle-piece icon → pin) for one-click checks. A red number on the icon means someone unfollowed you.</li>
    </ul>
  </section>

  {#if step === 4 && $followPromptDone === false}
    <section class="card follow">
      <h3>One last thing <span class="muted">(optional)</span></h3>
      <p class="muted">X changes its website a few times a year, and Ghosted may need a quick fix when it does. Follow @{FOLLOW_HANDLE} to hear about updates.</p>
      <div class="row">
        <a class="btn" href={FOLLOW_URL} target="_blank" rel="noopener" onclick={markFollowPromptDone}>Follow @{FOLLOW_HANDLE}</a>
        <button class="link" onclick={markFollowPromptDone}>No thanks</button>
      </div>
    </section>
  {/if}

  <button class="primary big" disabled={step < 4} onclick={openDashboard}>{step < 4 ? 'Finish the steps above' : 'Open your dashboard →'}</button>
</main>

<style>
  main { max-width: 680px; margin: 0 auto; padding: 48px 16px 64px; display: grid; gap: 18px; }
  header { display: grid; gap: 10px; justify-items: start; }
  .logo { width: 56px; height: 56px; filter: drop-shadow(0 6px 22px #e0a33a55); }
  h1 { font-size: clamp(28px, 5vw, 40px); line-height: 1.1; color: var(--text); }
  .lead { font-size: 16px; line-height: 1.5; margin: 0; }
  .steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .steps li { display: flex; gap: 14px; align-items: flex-start; padding: 16px; transition: border-color 0.2s, opacity 0.2s; opacity: 0.6; }
  .steps li.current { opacity: 1; border-color: #e0a33a88; box-shadow: 0 0 0 3px #e0a33a1a; }
  .steps li.done { opacity: 1; }
  .num { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: #ffffff12; font-weight: 700; flex-shrink: 0; }
  .done .num { background: var(--gain); color: #06130f; }
  .current .num { background: var(--amber); color: #1c0d0b; }
  h3 { font-size: 16px; font-family: inherit; }
  p { margin: 6px 0 10px; line-height: 1.45; }
  .tips ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.7; }
  .big { justify-self: start; padding: 12px 22px; font-size: 15px; }
  .follow { display: grid; gap: 8px; }
  .follow p { margin: 0; }
  .follow .btn { display: inline-block; padding: 6px 12px; border: 1px solid var(--line); border-radius: 7px; background: #ffffff10; color: var(--text); font-weight: 600; }
  .follow .btn:hover { background: #ffffff1c; text-decoration: none; }
  .link { background: none; border: 0; color: var(--muted); padding: 6px 8px; }
  .link:hover:not(:disabled) { background: none; color: var(--text); }
</style>
