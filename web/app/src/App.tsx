import { useEffect, useRef, useState } from 'react'
import { HashRouter, Link, Route, Routes, useNavigate } from 'react-router-dom'
import { findBook, loadCatalog, pageRoute, parseId, type Catalog } from './data'
import { AgentHelp } from './AgentHelp'
import { OPEN_AGENT_HELP } from './events'
import { Home } from './Home'
import { Car } from './Car'
import { Viewer } from './Viewer'
import { Calibrations } from './Calibrations'

export function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { loadCatalog().then(setCat, (e) => setErr(String(e))) }, [])
  return { cat, err }
}

function JumpToId() {
  const nav = useNavigate()
  const [v, setV] = useState('')
  const [msg, setMsg] = useState('')
  async function go(e: React.FormEvent) {
    e.preventDefault()
    const p = parseId(v)
    if (!p) { setMsg('Не похоже на ID. Пример: S31/s31j2002#A'); return }
    const book = p.book ?? (await findBook(p.page))
    if (!book) { setMsg('Страница не найдена в веб-версии'); return }
    setMsg('')
    nav(pageRoute(book, p.page, p.anchor))
  }
  return (
    <form className="jump" onSubmit={go} title="Вставьте ID источника из ответа агента, например [S31/s31j2002#A]">
      <input value={v} onChange={(e) => { setV(e.target.value); setMsg('') }} placeholder="Перейти к ID: S31/s31j2002#A" spellCheck={false} />
      <button type="submit">→</button>
      {msg && <span className="jump-msg">{msg}</span>}
    </form>
  )
}

function Header() {
  const [help, setHelp] = useState(false)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const open = () => setHelp(true)
    window.addEventListener(OPEN_AGENT_HELP, open)
    return () => window.removeEventListener(OPEN_AGENT_HELP, open)
  }, [])
  // expose the real header height (it wraps on narrow screens) to CSS: sticky panels/anchors use it
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <header className="top" ref={ref}>
      <Link to="/" className="brand">
        <span className="brand-mark">TSO</span>
        <span className="brand-text">Ford Service Manual <small>2000–2004</small></span>
      </Link>
      <JumpToId />
      <button className="help-btn" onClick={() => setHelp(true)}>🤖 <span className="long">Как пользоваться с ИИ-агентом</span><span className="short">ИИ-агент</span></button>
      {help && <AgentHelp onClose={() => setHelp(false)} />}
    </header>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/car/:model/:year" element={<Car />} />
          <Route path="/car/:model/:year/:tab" element={<Car />} />
          <Route path="/v/:book/:page" element={<Viewer />} />
          <Route path="/v/:book/:page/:anchor" element={<Viewer />} />
          <Route path="/calib" element={<Calibrations />} />
          <Route path="*" element={<div className="pad">Страница не найдена. <Link to="/">На главную</Link></div>} />
        </Routes>
      </main>
    </HashRouter>
  )
}
