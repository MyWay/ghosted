<script lang="ts">
  import Icon from './Icon.svelte';
  import { compact, signed } from './stats';

  let {
    label,
    value,
    delta,
    deltaLabel = 'vs 7 days ago',
    upIsGood = true,
    hero = false,
    onclick,
  }: {
    label: string;
    value: number | undefined;
    delta?: number;
    deltaLabel?: string;
    upIsGood?: boolean;
    hero?: boolean;
    onclick?: () => void;
  } = $props();

  const tone = $derived(delta === undefined || delta === 0 ? 'muted' : delta > 0 === upIsGood ? 'good' : 'bad');
</script>

<svelte:element this={onclick ? 'button' : 'div'} class="card tile" class:hero class:clickable={!!onclick} {onclick} role={onclick ? 'link' : undefined}>
  <div class="stat-label">{label}</div>
  <div class="stat-value" class:hero-value={hero}>{value === undefined ? '—' : compact(value)}</div>
  {#if delta !== undefined}
    <div class="delta {tone}">
      <Icon name={delta > 0 ? 'up' : delta < 0 ? 'down' : 'minus'} size={13} />
      {signed(delta)} <span class="muted">{deltaLabel}</span>
    </div>
  {/if}
</svelte:element>

<style>
  .tile { display: grid; gap: 2px; text-align: left; align-content: start; min-width: 0; }
  .clickable { cursor: pointer; font: inherit; color: inherit; }
  .clickable:hover { border-color: #e0a33a66; background: var(--surface); }
  .hero-value { font-size: 52px; letter-spacing: -0.02em; }
  .delta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; margin-top: 4px; }
</style>
