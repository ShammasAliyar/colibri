import { useEffect, useState } from "react"
import type { ActivityRequest } from "./lib/api"

export function DeveloperRequests({ baseUrl, requests, selected, onSelect }: {
  baseUrl: string; requests: ActivityRequest[]; selected: string; onSelect: (id: string) => void
}) {
  const storageKey = `colibri.developers:${baseUrl.replace(/\/+$/, "")}`
  const [names, setNames] = useState<Record<string, string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}")
      return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    } catch { return {} }
  })
  const clients = [...new Set(requests.map(request => request.client))]
  useEffect(() => {
    setNames(current => {
      const next = { ...current }
      for (const ip of clients) if (!Object.hasOwn(next, ip)) {
        const used = new Set(Object.values(next))
        let index = 1
        while (used.has(`Developer ${index}`)) index++
        next[ip] = `Developer ${index}`
      }
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }, [storageKey, clients.join("|")])
  const rename = (ip: string, name: string) => setNames(current => {
    const next = { ...current, [ip]: name }
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* storage unavailable */ }
    return next
  })
  return <aside className="activity-list" aria-label="Requests grouped by developer">
    <small>Grouped by client IP. Names are saved in this browser. Shared devices share a group.</small>
    {clients.map(ip => {
      const group = requests.filter(request => request.client === ip)
      const active = group.filter(request => !["completed", "failed", "cancelled"].includes(request.state)).length
      return <section className="developer-group" key={ip}>
        <header>
          <input aria-label={`Developer name for ${ip}`} value={names[ip] ?? "Developer"} maxLength={60}
            onChange={event => rename(ip, event.target.value)} placeholder="Developer name" />
          <small>{ip} · {group.length} requests · {active} active</small>
        </header>
        {group.slice().reverse().map(request => <button key={request.id} className={request.id === selected ? "selected" : ""} onClick={() => onSelect(request.id)}>
          <span><i className={`activity-dot ${request.state}`} />{request.endpoint.includes("/completions") && !request.endpoint.includes("chat") ? "Autocomplete" : "Chat / Agent"}<time>{request.elapsed_s.toFixed(1)}s</time></span>
          <small>{request.state} · {request.prompt_tokens ?? "…"} → {request.completion_tokens ?? "…"} tokens</small>
          <small>{new Date(request.started_at * 1000).toLocaleTimeString()} · {request.id.replace(/^req_/, "").slice(0, 8)}</small>
        </button>)}
      </section>
    })}
  </aside>
}
