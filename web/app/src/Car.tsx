import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useCatalog } from './App'
import { carBooks, idToRoute, loadBook, TYPE_LABEL, TYPE_SHORT, type Book, type Catalog } from './data'
import { highlight, search, tokens, type Hit } from './search'
import { Toc } from './Toc'

const TABS: [string, string][] = [
  ['search', 'Поиск'], ['SERVICE', 'Мануал'], ['PCED', 'PCED'], ['EVTM', 'Электросхемы'],
  ['BODYREP', 'Кузов'], ['TSB', 'TSB'], ['RECALL', 'Отзывы'],
]

function BookToc({ codes, cat }: { codes: string[]; cat: Catalog }) {
  const [books, setBooks] = useState<Book[]>([])
  useEffect(() => { Promise.all(codes.map(loadBook)).then(setBooks) }, [codes])
  if (!codes.length) return <div className="muted pad">Для этого автомобиля нет такого раздела.</div>
  if (!books.length) return <div className="muted pad">Загрузка…</div>
  return (
    <div className="book-tocs">
      {books.map((b) => (
        <section key={b.code} className="book-card">
          <h3>{b.title || cat.books[b.code]?.title || b.code} <span className="code">{b.code}</span></h3>
          {b.type === 'PCED' && <p className="muted small">Применимость: {b.vehicles.map((v) => `${v.y} ${v.m}${v.e && v.e !== 'All' ? ` (${v.e})` : ''}`).join('; ')}</p>}
          <Toc book={b.code} toc={b.toc} defaultOpen={b.type === 'EVTM' || b.type === 'PCED' ? 1 : 0} />
        </section>
      ))}
    </div>
  )
}

function DocList({ codes, cat }: { codes: string[]; cat: Catalog }) {
  const [f, setF] = useState('')
  const rows = useMemo(() => codes.map((c) => ({ c, ...cat.docs[c] })).filter((r) => r.t)
    .filter((r) => !f || `${r.n} ${r.t}`.toLowerCase().includes(f.toLowerCase()))
    .sort((a, b) => (b.d || '').localeCompare(a.d || '')), [codes, cat, f])
  if (!codes.length) return <div className="muted pad">Документов нет.</div>
  return (
    <div>
      <input className="filter" placeholder="Фильтр по номеру/заголовку…" value={f} onChange={(e) => setF(e.target.value)} />
      <table className="docs">
        <thead><tr><th>Номер</th><th>Дата</th><th>Заголовок</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.c}>
              <td className="nowrap"><Link to={`/v/${r.c}/_`}>{r.n || r.c}</Link></td>
              <td className="nowrap muted">{r.d ? `${r.d.slice(0, 4)}-${r.d.slice(4, 6)}-${r.d.slice(6, 8)}` : ''}</td>
              <td><Link to={`/v/${r.c}/_`}>{r.t.split('|')[0]}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SearchTab({ books, model, year }: { books: Record<string, string[]>; model: string; year: string }) {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const [input, setInput] = useState(q)
  const [types, setTypes] = useState<Set<string>>(new Set(['SERVICE', 'PCED', 'EVTM', 'BODYREP', 'TSB', 'RECALL']))
  const [res, setRes] = useState<{ hits: Hit[]; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const typeOf = useMemo(() => { const m: Record<string, string> = {}; for (const [t, bs] of Object.entries(books)) for (const b of bs) m[b] = t; return m }, [books])

  useEffect(() => {
    if (!q) { setRes(null); return }
    let live = true
    setBusy(true)
    const list = Object.entries(books).filter(([t]) => types.has(t)).flatMap(([, bs]) => bs)
    search(list, q).then((r) => { if (live) { setRes(r); setBusy(false) } })
    return () => { live = false }
  }, [q, books, types])

  const toks = tokens(q)
  return (
    <div className="search-tab">
      <form onSubmit={(e) => { e.preventDefault(); setSp(input ? { q: input } : {}) }} className="search-form">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Поиск по-английски для ${year} ${model}: brake caliper torque, P0171, fuel pump relay…`} autoFocus />
        <button type="submit">Искать</button>
      </form>
      <div className="chips">
        {Object.keys(books).filter((t) => t !== 'CALIB').map((t) => (
          <label key={t} className={`chip ${types.has(t) ? 'on' : ''}`}>
            <input type="checkbox" checked={types.has(t)} onChange={() => setTypes((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n })} />
            {TYPE_SHORT[t] ?? t} <span className="muted">({books[t].length})</span>
          </label>
        ))}
      </div>
      <p className="muted small">Мануал на английском: ищите английскими терминами Ford. Найдутся фрагменты, где встречаются все слова запроса.</p>
      {busy && <div className="muted">Поиск… (первый поиск загружает тексты, это может занять несколько секунд)</div>}
      {res && !busy && (
        <>
          <div className="muted small">Найдено: {res.total}{res.total > res.hits.length ? `, показаны первые ${res.hits.length}` : ''}</div>
          <ol className="hits">
            {res.hits.map((h) => {
              const [id, title, heading, section] = h.doc
              const route = idToRoute(id, q) ?? '/'
              return (
                <li key={id}>
                  <Link to={route} className="hit-title">
                    <span className={`tag t-${typeOf[h.book]}`}>{TYPE_SHORT[typeOf[h.book]] ?? h.book}</span>
                    {heading || title || id}
                  </Link>
                  <div className="hit-meta">{[section, heading && title !== heading ? title : ''].filter(Boolean).join(' · ')} <code className="cid">{id}</code></div>
                  <div className="hit-snip">{highlight(h.snippet, toks).map((p, i) => (typeof p === 'string' ? p : <mark key={i}>{p.m}</mark>))}</div>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </div>
  )
}

export function Car() {
  const { model = '', year = '', tab = 'search' } = useParams()
  const { cat } = useCatalog()
  const nav = useNavigate()
  if (!cat) return <div className="pad muted">Загрузка…</div>
  const books = carBooks(cat, model, year)
  const m = cat.models.find((x) => x.name === model)
  const years = m ? Object.keys(m.years) : []
  return (
    <div className="car">
      <div className="car-head">
        <h1>{year} {model}</h1>
        <select value={year} onChange={(e) => nav(`/car/${encodeURIComponent(model)}/${e.target.value}/${tab}`)}>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <Link key={k} className={`tab ${tab === k ? 'on' : ''} ${k !== 'search' && !books[k]?.length ? 'empty' : ''}`} to={`/car/${encodeURIComponent(model)}/${year}/${k}`}>
            {label}{k !== 'search' && books[k]?.length ? <span className="cnt">{books[k].length}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="tab-body">
        {tab === 'search' && <SearchTab books={books} model={model} year={year} />}
        {['SERVICE', 'PCED', 'EVTM', 'BODYREP'].includes(tab) && (
          <>
            <p className="muted small">{TYPE_LABEL[tab]}</p>
            <BookToc codes={books[tab] ?? []} cat={cat} />
          </>
        )}
        {(tab === 'TSB' || tab === 'RECALL') && <DocList codes={books[tab] ?? []} cat={cat} />}
      </div>
    </div>
  )
}
