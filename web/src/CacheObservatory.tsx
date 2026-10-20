import { useEffect, useMemo, useRef, useState } from "react"
import { Database, Flame, HardDrive, MemoryStick, RefreshCw } from "lucide-react"

import { getExperts, getHealth, type ActivityRequest, type ExpertMapResponse, type HealthResponse } from "@/lib/api"

const tierAt = (map: string, index: number) => (parseInt(map.slice(index * 2, index * 2 + 2), 16) || 0) >> 6
const hitAt = (hits: string, index: number) => !!((parseInt(hits.slice((index >> 3) * 2, (index >> 3) * 2 + 2), 16) || 0) & (1 << (index & 7)))

function Sparkline({ values, color, suffix = "" }: { values: number[]; color: string; suffix?: string }) {
  const max = Math.max(...values, 1), min = Math.min(...values, 0), span = Math.max(max - min, .001)
  const points = values.map((value, index) => `${values.length < 2 ? 0 : index * 100 / (values.length - 1)},${30 - (value - min) * 28 / span}`).join(" ")
  return <div className="cache-spark"><svg viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" /></svg><b>{values.length ? values[values.length - 1].toFixed(1) : "—"}{suffix}</b></div>
}

export function CacheObservatory({ baseUrl, apiKey, connected, requests }: { baseUrl: string; apiKey: string; connected: boolean; requests: ActivityRequest[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const previous = useRef("")
  const [experts, setExperts] = useState<ExpertMapResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [selectedLayer, setSelectedLayer] = useState(0)
  const [loaded, setLoaded] = useState<Set<number>>(new Set())
  const [evicted, setEvicted] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!connected) return
    let disposed = false
    const poll = async () => {
      if (document.hidden) return
      try {
        const [next, status] = await Promise.all([getExperts(baseUrl, apiKey), getHealth(baseUrl, apiKey)])
        if (disposed || !next.rows) return
        const came = new Set<number>(), went = new Set<number>()
        if (previous.current.length === next.map.length) for (let i = 0; i < next.rows * next.cols; i++) {
          const before = tierAt(previous.current, i), after = tierAt(next.map, i)
          if (!before && after) came.add(i)
          if (before && !after) went.add(i)
        }
        previous.current = next.map
        setLoaded(came); setEvicted(went); setExperts(next); setHealth(status)
      } catch { /* retain last good snapshot */ }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 1500)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [apiKey, baseUrl, connected])

  const totals = useMemo(() => {
    const out = [0, 0, 0]
    if (experts) for (let i = 0; i < experts.rows * experts.cols; i++) out[tierAt(experts.map, i)]++
    return out
  }, [experts])

  useEffect(() => {
    const el = canvas.current
    if (!el || !experts) return
    const scale = devicePixelRatio || 1, width = 900, cell = width / experts.cols, height = experts.rows * cell
    el.width = width * scale; el.height = height * scale; el.style.aspectRatio = `${width}/${height}`
    const ctx = el.getContext("2d"); if (!ctx) return
    ctx.scale(scale, scale); ctx.clearRect(0, 0, width, height)
    for (let row = 0; row < experts.rows; row++) for (let col = 0; col < experts.cols; col++) {
      const i = row * experts.cols + col, tier = tierAt(experts.map, i), hot = hitAt(experts.hits, i)
      ctx.fillStyle = loaded.has(i) ? "#f1b84b" : evicted.has(i) ? "#e06767" : hot ? "#73e6b8" : tier === 2 ? "#4ed6a5" : tier === 1 ? "#5a9bd8" : "#303b43"
      ctx.fillRect(col * cell + .5, row * cell + .5, Math.max(1, cell - 1), Math.max(1, cell - 1))
    }
    ctx.strokeStyle = "#ffffff99"; ctx.lineWidth = 1; ctx.strokeRect(.5, selectedLayer * cell + .5, width - 1, cell - 1)
  }, [experts, evicted, loaded, selectedLayer])

  const completed = requests.filter(request => request.state === "completed" && request.tokens_per_second != null).slice(-24)
  const last = completed[completed.length - 1]
  const layerGroups = useMemo(() => {
    const groups = { hot: [] as number[], resident: [] as number[], loaded: [] as number[], evicted: [] as number[], disk: [] as number[] }
    if (!experts) return groups
    for (let expert = 0; expert < experts.cols; expert++) {
      const i = selectedLayer * experts.cols + expert
      if (loaded.has(i)) groups.loaded.push(expert)
      else if (evicted.has(i)) groups.evicted.push(expert)
      else if (hitAt(experts.hits, i)) groups.hot.push(expert)
      else if (tierAt(experts.map, i)) groups.resident.push(expert)
      else groups.disk.push(expert)
    }
    return groups
  }, [experts, loaded, evicted, selectedLayer])
  const totalExperts = Math.max(1, totals.reduce((sum, value) => sum + value, 0))
  const warming = !last ? "cold" : (last.cache_hit_percent || 0) >= 90 ? "warm" : (last.cache_hit_percent || 0) >= 45 ? "warming" : "cold / changing"

  return <section className="cache-observatory">
    <header><div><span className="activity-eyebrow"><Database /> EXPERT CACHE EXPLORER</span><h2>Weights, residency and warming</h2><p>Disk remains the source; RAM and VRAM are live cached copies.</p></div><strong className={`cache-warm ${warming.startsWith("warm") ? "warm" : ""}`}><RefreshCw />{warming}</strong></header>
    <div className="weight-cards">
      <article><HardDrive /><span>Model on disk</span><strong>{health?.model_storage_gb?.toFixed(1) ?? "—"} GB</strong><small>complete checkpoint footprint</small></article>
      <article><MemoryStick /><span>Engine in RAM</span><strong>{last?.rss_gb?.toFixed(1) ?? "—"} GB</strong><small>actual RSS after latest turn</small></article>
      <article><Database /><span>Resident experts</span><strong>{(totals[1] + totals[2]).toLocaleString()}</strong><small>of {totalExperts.toLocaleString()} · cap {health?.expert_cache_cap ?? "—"}/layer</small></article>
      <article><Flame /><span>Latest cache hit</span><strong>{last?.cache_hit_percent?.toFixed(1) ?? "—"}%</strong><small>{loaded.size} loaded · {evicted.size} evicted</small></article>
    </div>
    <div className="weight-tier-bar"><i style={{ width: `${100 * totals[2] / totalExperts}%` }} className="vram" /><i style={{ width: `${100 * totals[1] / totalExperts}%` }} className="ram" /><i style={{ width: `${100 * totals[0] / totalExperts}%` }} className="disk" /></div>
    <div className="weight-tier-legend"><span><i className="vram" />VRAM {totals[2]}</span><span><i className="ram" />RAM {totals[1]}</span><span><i className="disk" />Disk only {totals[0]}</span></div>
    <div className="cache-trends">
      <article><span>Tokens / second</span><Sparkline values={completed.map(item => item.tokens_per_second || 0)} color="#4ed6a5" /></article>
      <article><span>Cache hit</span><Sparkline values={completed.map(item => item.cache_hit_percent || 0)} color="#5a9bd8" suffix="%" /></article>
      <article><span>Expert disk time</span><Sparkline values={completed.map(item => item.profile?.expert_disk_s || 0)} color="#f1b84b" suffix="s" /></article>
      <article><span>First output</span><Sparkline values={completed.map(item => (item.first_output_ms || 0) / 1000)} color="#9085e9" suffix="s" /></article>
    </div>
    <div className="expert-cache-panel">
      <div className="expert-map-head"><div><strong>{experts ? `${experts.rows} layers × ${experts.cols} experts` : "Waiting for expert map"}</strong><small>Click a row to inspect its exact expert mixture. Changes are measured between engine snapshots.</small></div><div><span className="hot" />used this turn <span className="new" />loaded <span className="gone" />evicted</div></div>
      <canvas ref={canvas} onClick={event => { if (!experts) return; const box = event.currentTarget.getBoundingClientRect(); setSelectedLayer(Math.min(experts.rows - 1, Math.floor((event.clientY - box.top) * experts.rows / box.height))) }} />
      {experts ? <div className="expert-layer-list"><header><strong>Layer {selectedLayer}</strong><span>{experts.cols - layerGroups.disk.length} resident · {layerGroups.hot.length} used this turn</span></header>{Object.entries(layerGroups).map(([name, ids]) => <div key={name}><b>{name}</b><p>{ids.length ? ids.map(id => <code key={id}>E{id}</code>) : <small>none</small>}</p></div>)}</div> : null}
    </div>
  </section>
}
