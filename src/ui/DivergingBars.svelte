<script lang="ts">
  import { niceTicks, type DayChange } from './stats';

  let { days, height = 200 }: { days: DayChange[]; height?: number } = $props();

  let width = $state(600);
  let hover = $state<number | null>(null);
  const pad = { top: 12, right: 12, bottom: 26, left: 40 };
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  /** Bar path with a 4px rounded data-end, square at the baseline. */
  function bar(x: number, w: number, y0: number, y1: number): string {
    const h = Math.abs(y1 - y0);
    if (h < 0.5) return '';
    const r = Math.min(4, h, w / 2);
    const up = y1 < y0;
    const tip = y1;
    const s = up ? 1 : -1; // direction from tip back toward baseline
    return `M${x},${y0}V${tip + s * r}Q${x},${tip} ${x + r},${tip}H${x + w - r}Q${x + w},${tip} ${x + w},${tip + s * r}V${y0}Z`;
  }

  const geo = $derived.by(() => {
    const maxUp = Math.max(1, ...days.map((d) => d.gained));
    const maxDown = Math.max(1, ...days.map((d) => d.lost));
    const ticks = niceTicks(-maxDown, maxUp, 4, true);
    const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
    const iw = Math.max(1, width - pad.left - pad.right);
    const ih = height - pad.top - pad.bottom;
    const y = (v: number) => pad.top + ((hi - v) / (hi - lo)) * ih;
    const slot = iw / days.length;
    const bw = Math.max(2, Math.min(24, slot - 2));
    const x = (i: number) => pad.left + i * slot + (slot - bw) / 2;
    return { ticks, y, slot, bw, x, zero: y(0) };
  });
  const totalGained = $derived(days.reduce((a, d) => a + d.gained, 0));
  const totalLost = $derived(days.reduce((a, d) => a + d.lost, 0));
</script>

<div class="legend">
  <span><i style="background:var(--gain)"></i>Gained ({totalGained.toLocaleString()})</span>
  <span><i style="background:var(--loss)"></i>Lost ({totalLost.toLocaleString()})</span>
</div>
<div class="chart-wrap" bind:clientWidth={width}>
  <svg {width} {height} role="img" aria-label="Followers gained and lost per day">
    {#each geo.ticks as t}
      <line x1={pad.left} x2={width - pad.right} y1={geo.y(t)} y2={geo.y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} stroke-width="1" />
      <text x={pad.left - 8} y={geo.y(t)} dy="0.32em" text-anchor="end" class="axis tabular">{Math.abs(t).toLocaleString()}</text>
    {/each}
    {#each days as d, i}
      {#if hover === i}<rect x={pad.left + i * geo.slot} y={pad.top} width={geo.slot} height={height - pad.top - pad.bottom} fill="#ffffff08" />{/if}
      <path d={bar(geo.x(i), geo.bw, geo.zero - 1, geo.y(d.gained))} fill="var(--gain)" />
      <path d={bar(geo.x(i), geo.bw, geo.zero + 1, geo.y(-d.lost))} fill="var(--loss)" />
      <rect
        x={pad.left + i * geo.slot}
        y={pad.top}
        width={geo.slot}
        height={height - pad.top - pad.bottom}
        fill="transparent"
        role="presentation"
        onpointerenter={() => (hover = i)}
        onpointerleave={() => (hover = null)}
      />
    {/each}
    <text x={pad.left} y={height - 6} class="axis">{fmt(days[0].day)}</text>
    <text x={width - pad.right} y={height - 6} text-anchor="end" class="axis">Today</text>
  </svg>
  {#if hover !== null}
    {@const d = days[hover]}
    <div class="tooltip" style="left:{geo.x(hover) + geo.bw / 2}px;top:{geo.y(d.gained)}px">
      <strong>{fmt(d.day)}</strong><br />
      <i class="key" style="background:var(--gain)"></i>+{d.gained} gained &nbsp; <i class="key" style="background:var(--loss)"></i>−{d.lost} lost
    </div>
  {/if}
</div>
<details class="table-view">
  <summary>Show as table</summary>
  <table>
    <thead><tr><th>Day</th><th>Gained</th><th>Lost</th></tr></thead>
    <tbody>{#each [...days].reverse().filter((d) => d.gained || d.lost) as d}<tr><td>{fmt(d.day)}</td><td class="tabular">{d.gained}</td><td class="tabular">{d.lost}</td></tr>{:else}<tr><td colspan="3">No changes in this period.</td></tr>{/each}</tbody>
  </table>
</details>

<style>
  svg { display: block; overflow: visible; }
  .axis { fill: var(--axis); font-size: 11px; }
  .key { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
</style>
