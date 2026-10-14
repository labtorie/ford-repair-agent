import { useEffect, useRef, useState } from 'react'
import { HashRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
  const [hidden, setHidden] = useState(false)
  const [height, setHeight] = useState(56)
  const ref = useRef<HTMLElement>(null)
  const loc = useLocation()
  useEffect(() => {
    const open = () => setHelp(true)
    window.addEventListener(OPEN_AGENT_HELP, open)
    return () => window.removeEventListener(OPEN_AGENT_HELP, open)
  }, [])
  // real header height (it wraps on narrow screens)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    setHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [])
  // hide on scroll down, show again as soon as the user scrolls up
  useEffect(() => {
    let last = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      const d = y - last
      if (y < 8) setHidden(false)
      else if (d > 6 && !ref.current?.contains(document.activeElement)) setHidden(true)
      else if (d < -6) setHidden(false)
      if (Math.abs(d) > 6 || y < 8) last = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => { setHidden(false) }, [loc.pathname])
  // CSS: --header-h = full height (page padding), --header-offset = visible part (sticky panels, drawer, anchors)
  useEffect(() => {
    const r = document.documentElement.style
    r.setProperty('--header-h', `${height}px`)
    r.setProperty('--header-offset', hidden ? '0px' : `${height}px`)
  }, [height, hidden])
  return (
    <>
      <header className={`top ${hidden ? 'hidden' : ''}`} ref={ref}>
        <Link to="/" className="brand">
          <span className="brand-mark">TSO</span>
          <span className="brand-text">Ford Service Manual <small>2000–2004</small></span>
        </Link>
        <JumpToId />
        <button className="help-btn" onClick={() => setHelp(true)}>🤖 <span className="long">Как пользоваться с ИИ-агентом</span><span className="short">ИИ-агент</span></button>
      </header>
      {help && <AgentHelp onClose={() => setHelp(false)} />}
    </>
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
