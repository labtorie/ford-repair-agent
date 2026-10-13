import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { pageRoute, type TocNode } from './data'

function pathTo(nodes: TocNode[], page: string, trail: string[] = []): string[] | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const k = [...trail, `${i}`]
    if (n.p === page) return k
    if (n.c) { const r = pathTo(n.c, page, k); if (r) return r }
  }
  return null
}

function filterTree(nodes: TocNode[], q: string): TocNode[] {
  const out: TocNode[] = []
  for (const n of nodes) {
    const self = n.t.toLowerCase().includes(q)
    if (self) { out.push(n); continue }
    if (n.c) { const c = filterTree(n.c, q); if (c.length) out.push({ ...n, c }) }
  }
  return out
}

export function Toc({ book, toc, current, defaultOpen = 0 }: { book: string; toc: TocNode[]; current?: string; defaultOpen?: number }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const curRef = useRef<HTMLAnchorElement | null>(null)

  useEffect(() => {
    if (!current) return
    const p = pathTo(toc, current)
    if (!p) return
    setOpen((o) => { const s = new Set(o); for (let i = 1; i < p.length; i++) s.add(p.slice(0, i).join('.')); return s })
  }, [toc, current])
  useEffect(() => { curRef.current?.scrollIntoView({ block: 'nearest' }) }, [current, open])

  const nodes = useMemo(() => (q.trim() ? filterTree(toc, q.trim().toLowerCase()) : toc), [toc, q])
  const forced = q.trim().length > 0

  const render = (ns: TocNode[], trail: string[], depth: number) => (
    <ul className={depth ? 'toc-sub' : 'toc'}>
      {ns.map((n, i) => {
        const k = [...trail, `${i}`].join('.')
        const isOpen = forced || open.has(k) || depth < defaultOpen
        if (n.c && n.c.length) {
          return (
            <li key={k}>
              <button className={`toc-dir ${isOpen ? 'open' : ''}`} onClick={() => setOpen((o) => { const s = new Set(o); if (s.has(k)) s.delete(k); else s.add(k); return s })}>
                <span className="caret">{isOpen ? '▾' : '▸'}</span>{n.t}
              </button>
              {isOpen && render(n.c, [...trail, `${i}`], depth + 1)}
              {n.p && null}
            </li>
          )
        }
        if (!n.p) return <li key={k} className="toc-empty">{n.t}</li>
        const cur = n.p === current
        return (
          <li key={k}>
            <Link ref={cur ? curRef : undefined} className={`toc-leaf ${cur ? 'cur' : ''}`} to={pageRoute(book, n.p)}>{n.t}</Link>
          </li>
        )
      })}
    </ul>
  )
  return (
    <div className="toc-wrap">
      <input className="toc-filter" placeholder="Фильтр оглавления…" value={q} onChange={(e) => setQ(e.target.value)} />
      {nodes.length ? render(nodes, [], 0) : <div className="muted small pad">Ничего не найдено</div>}
    </div>
  )
}
