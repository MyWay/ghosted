<script lang="ts">
  import { niceTicks, type Point } from './stats';

  let { points, label, height = 200 }: { points: Point[]; label: string; height?: number } = $props();

  let width = $state(600);
  let hover = $state<number | null>(null);
  const pad = { top: 16, right: 56, bottom: 26, left: 48 };
  const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const geo = $derived.by(() => {
    const vs = points.map((p) => p.v);
    const ticks = niceTicks(Math.min(...vs), Math.max(...vs), 4, true);
    const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const iw = Math.max(1, width - pad.left - pad.right);
    const ih = height - pad.top - pad.bottom;
    const x = (t: number) => pad.left + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
    const y = (v: number) => pad.top + ih - ((v - lo) / (hi - lo || 1)) * ih;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = `${line}L${x(t1).toFixed(1)},${pad.top + ih}L${x(t0).toFixed(1)},${pad.top + ih}Z`;
    return { ticks, x, y, line, area, ih };
  });

  function onMove(e: PointerEvent) {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(geo.x(p.t) - mx) < Math.abs(geo.x(points[best].t) - mx)) best = i;
    });
    hover = best;
  }
  const last = $derived(points[points.length - 1]);
</script>

<div class="chart-wrap" bind:clientWidth={width}>
  <svg {width} {height} role="img" aria-label={label} onpointermove={onMove} onpointerleave={() => (hover = null)}>
    {#each geo.ticks as t}
      <line x1={pad.left} x2={width - pad.right} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--grid)" stroke-width="1" />
      <text x={pad.left - 8} y={geo.y(t)} dy="0.32em" text-anchor="end" class="axis tabular">{t.toLocaleString()}</text>
    {/each}
    <text x={pad.left} y={height - 6} class="axis">{fmtDate(points[0].t)}</text>
    {#if points.length > 1}<text x={width - pad.right} y={height - 6} text-anchor="end" class="axis">{fmtDate(last.t)}</text>{/if}
    <path d={geo.area} fill="var(--series)" opacity="0.1" />
    <path d={geo.line} fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx={geo.x(last.t)} cy={geo.y(last.v)} r="4.5" fill="var(--series)" stroke="var(--surface)" stroke-width="2" />
    <text x={geo.x(last.t) + 10} y={geo.y(last.v)} dy="0.32em" class="end-label">{last.v.toLocaleString()}</text>
    {#if hover !== null}
      {@const p = points[hover]}
      <line x1={geo.x(p.t)} x2={geo.x(p.t)} y1={pad.top} y2={pad.top + geo.ih} stroke="var(--axis)" stroke-width="1" />
      <circle cx={geo.x(p.t)} cy={geo.y(p.v)} r="5" fill="var(--series)" stroke="var(--surface)" stroke-width="2" />
    {/if}
  </svg>
  {#if hover !== null}
    {@const p = points[hover]}
    <div class="tooltip" style="left:{geo.x(p.t)}px;top:{geo.y(p.v)}px">
      <strong class="tabular">{p.v.toLocaleString()}</strong> <span class="muted">{label.toLowerCase()} · {new Date(p.t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
    </div>
  {/if}
</div>
<details class="table-view">
  <summary>Show as table</summary>
  <table>
    <thead><tr><th>Scan</th><th>{label}</th></tr></thead>
    <tbody>{#each [...points].reverse() as p}<tr><td>{new Date(p.t).toLocaleString()}</td><td class="tabular">{p.v.toLocaleString()}</td></tr>{/each}</tbody>
  </table>
</details>

<style>
  svg { display: block; overflow: visible; touch-action: none; }
  .axis { fill: var(--axis); font-size: 11px; }
  .end-label { fill: var(--text); font-size: 12px; font-weight: 600; }
</style>
