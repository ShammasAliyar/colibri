import { useEffect, useState } from "react"
import { Activity, Braces, Clock3, Gauge, HardDrive, ListTree, Radio, Timer, Wrench } from "lucide-react"

import { getActivity, getProfile, type ActivityRequest, type ProfileTurn } from "@/lib/api"
import { useLocale } from "./i18n"
import { CacheObservatory } from "./CacheObservatory"
import { DeveloperRequests } from "./DeveloperRequests"

const PHASES = [
  { key: "expert_wait_s", i18n: "profile.ioWait", color: "#3987e5" },
  { key: "expert_matmul_s", i18n: "profile.expertMatmul", color: "#199e70" },
  { key: "attention_s", i18n: "profile.attention", color: "#c98500" },
  { key: "lm_head_s", i18n: "profile.lmHead", color: "#008300" },
  { key: "other_s", i18n: "profile.other", color: "#9085e9" },
] as const

interface Turn extends ProfileTurn { other_s: number; toks: number }

const derive = (turn: ProfileTurn): Turn => ({
  ...turn,
  other_s: Math.max(0, turn.wall_s - turn.expert_wait_s - turn.expert_matmul_s - turn.attention_s - turn.lm_head_s),
  toks: turn.wall_s > 0 ? turn.completion_tokens / turn.wall_s : 0,
})

const seconds = (value: number) => (value >= 10 ? value.toFixed(1) : value.toFixed(2)) + "s"

const shortId = (id: string) => id.replace(/^req_/, "").slice(0, 8)
const endpointName = (path: string) => path.includes("/completions") && !path.includes("chat") ? "Autocomplete" : path.includes("messages") ? "Anthropic" : "Chat / Agent"

function ContextBar({ request }: { request: ActivityRequest }) {
  const total = Math.max(1, request.messages.reduce((sum, message) => sum + message.chars, 0))
  const colors: Record<string, string> = { system: "#9085e9", user: "#3987e5", assistant: "#199e70", tool: "#c98500" }
  return <div className="activity-context-bar" aria-label="Context composition">
    {request.messages.map(message => message.chars ? <span key={message.index} style={{ width: `${100 * message.chars / total}%`, background: colors[message.role] || "#718087" }} title={`${message.role}: ${message.chars.toLocaleString()} characters`} /> : null)}
  </div>
}

function TimeBreakdown({ request }: { request: ActivityRequest }) {
  const queue = Math.max(0, (request.queue_wait_ms ?? 0) / 1000)
  const beforeOutput = Math.max(0, (request.first_output_ms ?? 0) / 1000)
  const profile = request.profile
  const cpu = profile ? Math.max(0, profile.expert_matmul_s + profile.attention_s + profile.lm_head_s) : 0
  const disk = profile ? Math.max(0, profile.expert_disk_s) : 0
  const other = profile ? Math.max(0, request.elapsed_s - queue - beforeOutput - cpu - disk) : 0
  const rows = [
    { label: "Waiting for an inference slot", value: queue, color: "#718087", detail: "Queue" },
    { label: "Reading and processing your prompt before answering", value: beforeOutput, color: "#9085e9", detail: `${request.fresh_tokens ?? request.prompt_tokens ?? "…"} fresh input tokens` },
    { label: "Calculating the answer using the CPU", value: cpu, color: "#199e70", detail: "Expert math + attention" },
    { label: "Reading required expert weights from storage", value: disk, color: "#3987e5", detail: "Expert disk service" },
    { label: "Other server and answer-generation work", value: other, color: "#c98500", detail: "Sampling, streaming and unclassified work" },
  ]
  if (request.first_output_ms == null || !profile) return <section className="activity-card time-breakdown">
    <header><span><Timer /> What the server is doing</span><small>live request · detailed split appears after completion</small></header>
    <div className="activity-running"><Radio /> {request.state === "received" ? "Waiting to enter the engine" : `Processing for ${seconds(request.elapsed_s)} so far`}</div>
  </section>
  return <section className="activity-card time-breakdown">
    <header><span><Timer /> Where the request time went</span><small>plain-language measured breakdown</small></header>
    <div className="time-breakdown-bar" role="img" aria-label={rows.map(row => `${row.label}: ${seconds(row.value)}`).join(", ")}>
      {rows.map(row => row.value > 0 ? <span key={row.label} style={{ width: `${100 * row.value / Math.max(request.elapsed_s, .001)}%`, background: row.color }} title={`${row.label}: ${seconds(row.value)}`} /> : null)}
    </div>
    <div className="time-breakdown-table">
      {rows.map(row => <div key={row.label}><i style={{ background: row.color }} /><span>{row.label}<small>{row.detail}</small></span><strong>{seconds(row.value)}</strong><b>{(100 * row.value / Math.max(request.elapsed_s, .001)).toFixed(1)}%</b></div>)}
      <div className="total"><i /><span>Total request time<small>From server receipt to completion</small></span><strong>{seconds(request.elapsed_s)}</strong><b>100%</b></div>
    </div>
    <p className="time-breakdown-note">The CPU row combines measured attention and expert calculation. Prompt processing is measured to first output; its internal CPU and storage work are not yet separated.</p>
  </section>
}

function RequestDetail({ request, contentCapture }: { request: ActivityRequest; contentCapture: boolean }) {
  const profile = request.profile
  const phase = profile ? [
    ["Disk", profile.expert_disk_s, "#3987e5"],
    ["Expert", profile.expert_matmul_s, "#199e70"],
    ["Attention", profile.attention_s, "#c98500"],
    ["Other", Math.max(0, profile.wall_s - profile.expert_wait_s - profile.expert_matmul_s - profile.attention_s - profile.lm_head_s), "#9085e9"],
  ] as const : []
  return <div className="activity-detail">
    <div className="activity-detail-head">
      <div><span className={`activity-state ${request.state}`}><i />{request.state}</span><h2>{endpointName(request.endpoint)}</h2><code>{shortId(request.id)}</code></div>
      <strong>{seconds(request.elapsed_s)}</strong>
    </div>
    <div className="activity-kpis">
      <div><span>Context</span><strong>{request.prompt_tokens?.toLocaleString() ?? "…"}</strong><small>tokens · {request.context_chars.toLocaleString()} chars</small></div>
      <div><span>Generated</span><strong>{request.completion_tokens || "…"}</strong><small>{request.output_chars.toLocaleString()} streamed chars</small></div>
      <div><span>Throughput</span><strong>{request.tokens_per_second?.toFixed(2) ?? "…"}</strong><small>tokens / second</small></div>
      <div><span>First output</span><strong>{request.first_output_ms != null ? `${request.first_output_ms}ms` : "…"}</strong><small>queue {request.queue_wait_ms ?? 0}ms</small></div>
    </div>
    <TimeBreakdown request={request} />
    <section className="activity-card">
      <header><span><ListTree /> Context received</span><small>{request.message_count} messages · {request.tool_count} tools · {contentCapture ? "content capture enabled" : "raw content private"}</small></header>
      <p>KV prefix reuse: {request.reused_tokens == null ? "Not reported by engine yet" : `${request.reused_tokens.toLocaleString()} reused / ${(request.prompt_tokens ?? 0).toLocaleString()} input tokens (${(100 * request.reused_tokens / Math.max(1, request.prompt_tokens ?? 0)).toFixed(1)}%). ${request.fresh_tokens?.toLocaleString()} tokens require processing.`}</p>
      <ContextBar request={request} />
      <div className="context-legend">
        {request.messages.map(message => <span key={message.index}><i data-role={message.role} />{message.role}<b>{message.chars.toLocaleString()}</b></span>)}
      </div>
      {request.tool_names.length ? <div className="tool-strip"><Wrench />{request.tool_names.map(name => <code key={name}>{name}</code>)}</div> : null}
      {contentCapture ? <div className="activity-prompts">
        {request.messages.map(message => message.preview != null ? <article key={message.index}>
          <header><span>{message.role}</span><small>message {message.index + 1} · {message.chars.toLocaleString()} chars</small></header>
          <pre>{message.preview || "(empty message)"}</pre>
          {message.preview.length < message.chars ? <small>Preview truncated by the server.</small> : null}
        </article> : null)}
      </div> : null}
    </section>
    <section className="activity-card">
      <header><span><Activity /> Inference phases</span><small>{profile ? `${profile.forwards} forwards` : "available when the turn completes"}</small></header>
      {profile ? <><div className="activity-phase-bar">{phase.map(([name, value, color]) => <span key={name} style={{ width: `${100 * value / Math.max(profile.wall_s, .001)}%`, background: color }} title={`${name}: ${seconds(value)}`} />)}</div><div className="phase-list">{phase.map(([name, value, color]) => <span key={name}><i style={{ background: color }} />{name}<b>{seconds(value)}</b></span>)}</div></> : <div className="activity-running"><Radio /> Live generation in progress</div>}
    </section>
  </div>
}

function ShareBar({ label, turns }: { label: string; turns: Turn[] }) {
  const { t } = useLocale()
  const total = turns.reduce((sum, turn) => sum + turn.wall_s, 0)
  const parts = PHASES.map((phase) => ({ ...phase, name: t(phase.i18n), value: turns.reduce((sum, turn) => sum + turn[phase.key], 0) }))
  return (
    <div className="prof-share">
      <div className="prof-share-head"><span>{label}</span><code>{seconds(total)}</code></div>
      <div className="prof-share-bar" role="img" aria-label={parts.map((part) => `${part.name} ${seconds(part.value)}`).join(", ")}>
        {parts.map((part) => {
          const share = total > 0 ? part.value / total : 0
          return share > 0.001 ? (
            <span key={part.key} style={{ width: `${100 * share}%`, background: part.color }} title={`${part.name} — ${seconds(part.value)} (${(100 * share).toFixed(1)}%)`}>
              {share >= 0.09 ? `${Math.round(100 * share)}%` : ""}
            </span>
          ) : null
        })}
      </div>
    </div>
  )
}

function TurnColumns({ turns, stacked, height, format, footLabel, footLabelOne }: { turns: Turn[]; stacked: boolean; height: number; format: (turn: Turn) => string; footLabel: string; footLabelOne: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const peak = Math.max(...turns.map((turn) => (stacked ? turn.wall_s : turn.toks)), 1e-9)
  const gap = 2
  const width = Math.max(1, (100 - gap * (turns.length - 1)) / turns.length)
  return (
    <div className="prof-plot" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map((line) => <line key={line} x1="0" x2="100" y1={height * line} y2={height * line} className="prof-grid" />)}
        {turns.map((turn, index) => {
          const x = index * (width + gap)
          if (!stacked) {
            const h = (height * turn.toks) / peak
            return <rect key={index} x={x} y={height - h} width={width} height={h} rx="1" fill="var(--primary)" opacity={hover === null || hover === index ? 1 : 0.45} />
          }
          let y = height
          return PHASES.map((phase) => {
            const h = (height * turn[phase.key]) / peak
            y -= h
            return h > 0.1 ? <rect key={`${index}-${phase.key}`} x={x} y={y + 0.35} width={width} height={Math.max(h - 0.7, 0.35)} fill={phase.color} opacity={hover === null || hover === index ? 1 : 0.45} /> : null
          })
        })}
        {turns.map((_, index) => <rect key={index} x={index * (width + gap) - gap / 2} y="0" width={width + gap} height={height} fill="transparent" onMouseEnter={() => setHover(index)} />)}
      </svg>
      <div className="prof-plot-foot">
        <span>{turns.length > 1 ? footLabel : footLabelOne}</span>
        <code>{hover !== null && turns[hover] ? format(turns[hover]) : `peak ${stacked ? seconds(peak) : peak.toFixed(1) + " tok/s"}`}</code>
      </div>
    </div>
  )
}

export function Profiling({ baseUrl, apiKey, connected }: { baseUrl: string; apiKey: string; connected: boolean }) {
  const { t } = useLocale()
  const [turns, setTurns] = useState<Turn[]>([])
  const [requests, setRequests] = useState<ActivityRequest[]>([])
  const [contentCapture, setContentCapture] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!connected) return
    let disposed = false
    const poll = async () => {
      if (document.visibilityState === "hidden") return
      try {
        const result = await getProfile(baseUrl, apiKey)
        if (!disposed) setTurns(result.turns.map(derive))
      } catch { /* engine busy or restarting — keep the last snapshot */ }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [baseUrl, apiKey, connected])

  useEffect(() => {
    if (!connected) return
    let disposed = false
    const poll = async () => {
      if (document.visibilityState === "hidden") return
      try {
        const result = await getActivity(baseUrl, apiKey)
        if (!disposed) {
          setRequests(result.requests)
          setContentCapture(result.content_capture)
          if (!selected && result.requests.length) setSelected(result.requests[result.requests.length - 1].id)
        }
      } catch { /* retain the last view while the engine restarts */ }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [apiKey, baseUrl, connected, selected])

  const latest = turns[turns.length - 1]
  const recent = turns.slice(-40)
  const diskService = turns.reduce((sum, turn) => sum + turn.expert_disk_s, 0)
  const active = requests.filter(request => !["completed", "failed", "cancelled"].includes(request.state))
  const chosen = requests.find(request => request.id === selected) || active[0] || requests[requests.length - 1]

  return (
    <div className="prof-page">
      <div className="activity-hero">
        <div><span className="activity-eyebrow"><Radio /> LIVE REQUEST TELEMETRY</span><h1>{active.length ? `${active.length} inference${active.length === 1 ? "" : "s"} running` : "Engine standing by"}</h1><p>Continue request lifecycle, context shape and engine work in one view.</p></div>
        <div className="activity-hero-stats"><span><Clock3 />{requests.length} captured</span><span><Braces />{contentCapture ? "prompt capture on" : "metadata only"}</span></div>
      </div>
      {chosen ? <div className="activity-layout">
        <DeveloperRequests key={baseUrl} baseUrl={baseUrl} requests={requests} selected={chosen.id} onSelect={setSelected} />
        <RequestDetail request={chosen} contentCapture={contentCapture} />
      </div> : <div className="activity-empty"><Radio /><strong>Waiting for Continue</strong><span>The next authenticated inference request will appear here live.</span></div>}

      <CacheObservatory baseUrl={baseUrl} apiKey={apiKey} connected={connected} requests={requests} />
      <section className="activity-card" aria-label="KV token reuse history">
        <header><span>KV prefix reuse · last 20 requests</span><small>Green = reused tokens · blue = fresh tokens</small></header>
        <p>Measured by the engine before prefill. Reuse depends on matching cached context, not simply being the second request. This is separate from expert-weight caching.</p>
        {!requests.length && <p>Send requests from Continue to populate this graph.</p>}
        {requests.slice(-20).map(request => <div key={request.id} style={{ marginBottom: 14 }}>
          <button onClick={() => setSelected(request.id)}>{shortId(request.id)} · {request.client}</button>
          {request.reused_tokens == null ? <small> Reuse unavailable</small> : <>
            <div className="activity-context-bar" role="img" aria-label={`${request.reused_tokens} reused, ${request.fresh_tokens} fresh tokens`}>
              <span style={{ width: `${100 * request.reused_tokens / Math.max(1, request.prompt_tokens ?? 0)}%`, background: "#36c891" }} />
              <span style={{ width: `${100 * (request.fresh_tokens ?? 0) / Math.max(1, request.prompt_tokens ?? 0)}%`, background: "#3987e5" }} />
            </div>
            <small>{request.reused_tokens.toLocaleString()} reused + {request.fresh_tokens?.toLocaleString()} fresh = {request.prompt_tokens?.toLocaleString()} input · {(100 * request.reused_tokens / Math.max(1, request.prompt_tokens ?? 0)).toFixed(1)}% reuse · first output {request.first_output_ms == null ? "pending" : seconds(request.first_output_ms / 1000)}</small>
          </>}
        </div>)}
      </section>

      <div className="prof-head">
        <div className="section-title"><Gauge className="size-4" /> {t("profile.title")}</div>
        <div className="prof-legend">
          {PHASES.map((phase) => <span key={phase.key}><i style={{ background: phase.color }} />{t(phase.i18n)}</span>)}
        </div>
      </div>

      {!latest ? (
        <p className="runtime-unavailable">{connected ? t("profile.empty") : t("profile.connectHint")}</p>
      ) : (
        <>
          <div className="prof-tiles">
            <div><span><Gauge className="size-3" /> {t("profile.lastTurn")}</span><strong>{latest.toks.toFixed(1)}</strong><small>tok/s</small></div>
            <div><span><Timer className="size-3" /> {t("profile.wallTime")}</span><strong>{seconds(latest.wall_s)}</strong><small>{latest.prompt_tokens} → {latest.completion_tokens} tokens</small></div>
            <div><span><Activity className="size-3" /> {t("profile.batching")}</span><strong>{latest.forwards > 0 ? (latest.completion_tokens / latest.forwards).toFixed(2) : "—"}</strong><small>{t("profile.tokensPerForward")}</small></div>
            <div><span><HardDrive className="size-3" /> {t("profile.diskService")}</span><strong>{seconds(latest.expert_disk_s)}</strong><small>{t("profile.overlapped")}</small></div>
          </div>

          <div className="prof-shares">
            <ShareBar label={t("profile.lastTurn")} turns={[latest]} />
            {turns.length > 1 ? <ShareBar label={t("profile.window", { n: turns.length })} turns={turns} /> : null}
          </div>

          <div className="prof-charts">
            <div className="prof-chart">
              <div className="prof-chart-title">{t("profile.throughputTitle")}</div>
              <TurnColumns turns={recent} stacked={false} height={36} footLabel={t("profile.turnsLabel", { n: recent.length })} footLabelOne={t("profile.oneTurn")} format={(turn) => `${turn.toks.toFixed(1)} tok/s · ${turn.completion_tokens} tokens`} />
            </div>
            <div className="prof-chart">
              <div className="prof-chart-title">{t("profile.phaseTitle")}</div>
              <TurnColumns turns={recent} stacked height={36} footLabel={t("profile.turnsLabel", { n: recent.length })} footLabelOne={t("profile.oneTurn")} format={(turn) => `${seconds(turn.wall_s)} · ${PHASES.map((phase) => `${t(phase.i18n)} ${seconds(turn[phase.key])}`).join(" · ")}`} />
            </div>
          </div>

          <div className="prof-table-wrap">
            <table className="prof-table">
              <thead><tr><th>{t("profile.turnCol")}</th><th>{t("profile.tokensCol")}</th><th>tok/s</th><th>{t("profile.wallCol")}</th>{PHASES.map((phase) => <th key={phase.key}><i style={{ background: phase.color }} />{t(phase.i18n)}</th>)}<th>{t("profile.diskService")}</th></tr></thead>
              <tbody>
                {recent.slice().reverse().map((turn, index) => (
                  <tr key={turns.length - index}>
                    <td>{turns.length - index}</td>
                    <td>{turn.prompt_tokens} → {turn.completion_tokens}</td>
                    <td>{turn.toks.toFixed(1)}</td>
                    <td>{seconds(turn.wall_s)}</td>
                    {PHASES.map((phase) => <td key={phase.key}>{seconds(turn[phase.key])}</td>)}
                    <td>{seconds(turn.expert_disk_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {diskService > 0 ? <p className="prof-note">{t("profile.diskNote")}</p> : null}
          </div>
        </>
      )}
    </div>
  )
}
