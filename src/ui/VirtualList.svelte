<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  let { items, rowHeight = 56, height = 520, row }: { items: T[]; rowHeight?: number; height?: number; row: Snippet<[T]> } = $props();
  let scrollTop = $state(0);
  const overscan = 6;
  const start = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const end = $derived(Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan));
</script>

<div class="viewport" style="height:{height}px" onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}>
  <div style="height:{items.length * rowHeight}px;position:relative">
    {#each items.slice(start, end) as item, i (start + i)}
      <div class="item" style="top:{(start + i) * rowHeight}px;height:{rowHeight}px">{@render row(item)}</div>
    {/each}
  </div>
</div>

<style>
  .viewport { overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
  .item { position: absolute; left: 0; right: 0; padding: 0 12px; display: flex; align-items: center; border-bottom: 1px solid var(--line); }
  .item > :global(*) { flex: 1; min-width: 0; }
</style>
