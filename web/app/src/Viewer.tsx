import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  loadBook, loadConfig, loadPage, loadSearch, mediaUrl, pageRoute, resolveMedia, TYPE_LABEL,
  type Book, type Config, type Page, type SearchDoc, type TocNode,
} from './data'
import { tokens } from './search'
import { Toc } from './Toc'

function crumbs(nodes: TocNode[], page: string, trail: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.p === page) return [...trail, n.t]
    if (n.c) { const r = crumbs(n.c, page, [...trail, n.t]); if (r) return r }
  }
  return null
}

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button className="copy" title="Скопировать ID для ссылки в вопросе агенту" onClick={() => {
      navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200) })
    }}>{ok ? '✓' : '⧉'}</button>
  )
}

function markTerms(root: HTMLElement, toks: string[]) {
  if (!toks.length) return null
  const re = new RegExp(toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  let first: HTMLElement | null = null
  for (const n of nodes) {
    const s = n.nodeValue ?? ''
    re.lastIndex = 0
    if (!re.test(s)) continue
    re.lastIndex = 0
    const frag = document.createDocumentFragment()
    let last = 0
    for (const m of s.matchAll(re)) {
      frag.append(s.slice(last, m.index))
      const mk = document.createElement('mark')
      mk.textContent = m[0]
      frag.append(mk)
      if (!first) first = mk
      last = (m.index ?? 0) + m[0].length
    }
    frag.append(s.slice(last))
    n.replaceWith(frag)
  }
  return first
}

export function Viewer() {
  const { book = '', page = '', anchor } = useParams()
  const [sp] = useSearchParams()
  const hl = sp.get('hl') ?? ''
  const nav = useNavigate()
  const [bk, setBk] = useState<Book | null>(null)
  const [pg, setPg] = useState<Page | null | undefined>(undefined)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [chunks, setChunks] = useState<SearchDoc[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [side, setSide] = useState(false)
  // mobile TOC drawer: close on navigation and on Escape
  useEffect(() => { setSide(false) }, [book, page, anchor])
  useEffect(() => {
    if (!side) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setSide(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [side])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { loadConfig().then(setCfg, () => setCfg({ packs: {} })) }, [])
  // "/v/BOOK/_" → first page of the book
  useEffect(() => {
    if (page === '_' && bk?.code === book && bk.seq.length) nav(pageRoute(book, bk.seq[0]), { replace: true })
  }, [page, bk, book, nav])
  useEffect(() => {
    setErr(null); setPg(undefined)
    loadBook(book).then(setBk, (e) => setErr(String(e)))
    if (page === '_') return
    loadPage(book, page).then(setPg, (e) => setErr(String(e)))
    loadSearch(book).then((d) => setChunks(d.filter((x) => x[0] === `${book}/${page}` || x[0].startsWith(`${book}/${page}#`) || x[0].startsWith(`${book}/${page}.`) || x[0].startsWith(`${book}/${page}~`))), () => setChunks([]))
  }, [book, page])

  const html = useMemo(() => (pg?.h && cfg ? resolveMedia(pg.h, cfg) : ''), [pg, cfg])

  // after render: wire links, highlight, scroll
  useEffect(() => {
    const el = ref.current
    if (!el || !pg) return
    el.querySelectorAll<HTMLAnchorElement>('a[data-media]').forEach((a) => { a.target = '_blank'; a.rel = 'noreferrer' })
    const first = markTerms(el, tokens(hl))
    const target = anchor ? document.getElementById(`a-${anchor}`) : null
    if (target) {
      target.scrollIntoView({ block: 'start' })
      const row = target.closest('tr') ?? target.parentElement
      row?.classList.add('flash')
    } else if (first) first.scrollIntoView({ block: 'center' })
    else window.scrollTo(0, 0)
  }, [html, pg, anchor, hl])

  function onClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (href?.startsWith('#a:')) {
      e.preventDefault()
      nav(pageRoute(book, page, href.slice(3)))
    }
  }

  const idx = bk ? bk.seq.indexOf(page) : -1
  const prev = bk && idx > 0 ? bk.seq[idx - 1] : null
  const next = bk && idx >= 0 && idx < bk.seq.length - 1 ? bk.seq[idx + 1] : null
  const path = bk ? crumbs(bk.toc, page) : null
  const pageId = `${book}/${page}`
  const car = bk?.vehicles.find((v) => v.y >= 2000)

  return (
    <div className={`viewer ${side ? 'side-open' : ''}`}>
      {side && <div className="v-backdrop" onClick={() => setSide(false)} />}
      <aside className="v-toc">
        <div className="v-toc-close"><span>Оглавление</span><button onClick={() => setSide(false)} aria-label="Закрыть оглавление">✕ Закрыть</button></div>
        {bk && (
          <>
            <div className="v-book">
              <div className="muted small">{TYPE_LABEL[bk.type] ?? bk.type}</div>
              <b>{bk.title || bk.code}</b> <span className="code">{bk.code}</span>
              {car && bk.type !== 'PCED' && bk.type !== 'TSB' && bk.type !== 'RECALL' && (
                <div><Link className="small" to={`/car/${encodeURIComponent(car.m)}/${car.y}`}>← {car.y} {car.m}</Link></div>
              )}
            </div>
            <Toc book={book} toc={bk.toc} current={page} />
          </>
        )}
      </aside>
      <article className="v-main">
        <button className="side-toggle" onClick={() => setSide(true)}>☰ Оглавление</button>
        {err && <div className="error">Ошибка загрузки: {err}</div>}
        {path && <div className="crumbs">{path.slice(0, -1).join(' › ')}</div>}
        <div className="v-head">
          <h2>{pg?.t || path?.[path.length - 1] || page}</h2>
          <div className="pid">ID: <code>{pageId}</code><Copy text={pageId} /></div>
        </div>
        {(bk?.type === 'TSB' || bk?.type === 'RECALL') && bk.vehicles.length > 0 && (
          <div className="applies">Применимость: {bk.vehicles.map((v) => `${v.y} ${v.m}`).join('; ')}</div>
        )}
        {pg === undefined && !err && <div className="muted">Загрузка…</div>}
        {pg === null && <div className="error">Страница {page} не найдена в {book}.</div>}
        {pg?.pdf && cfg && (
          <div className="pdf">
            <a href={mediaUrl(pg.pdf, cfg)} target="_blank" rel="noreferrer">Открыть PDF в новой вкладке ↗</a>
            <iframe src={mediaUrl(pg.pdf, cfg)} title={pg.t} />
          </div>
        )}
        {html && <div className="manual" ref={ref} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />}
        <div className="pager">
          {prev ? <Link to={pageRoute(book, prev)}>← Назад</Link> : <span />}
          {next ? <Link to={pageRoute(book, next)}>Вперёд →</Link> : <span />}
        </div>
      </article>
      <aside className="v-outline">
        {chunks.length > 0 && (
          <>
            <div className="muted small">Фрагменты страницы (ID для агента)</div>
            <ul>
              {chunks.map((c) => {
                const a = c[0].match(/#([^.~]+)/)?.[1]
                return (
                  <li key={c[0]} className={a && a === anchor ? 'cur' : ''}>
                    <Link to={pageRoute(book, page, a)}>{c[2] || c[1] || 'Начало страницы'}</Link>
                    <div><code>{c[0]}</code><Copy text={c[0]} /></div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </aside>
    </div>
  )
}
