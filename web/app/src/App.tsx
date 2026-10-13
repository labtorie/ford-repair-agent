import { useEffect, useState } from 'react'
import { HashRouter, Link, Route, Routes, useNavigate } from 'react-router-dom'
import { findBook, loadCatalog, pageRoute, parseId, type Catalog } from './data'
import { AgentHelp } from './AgentHelp'
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
  return (
    <header className="top">
      <Link to="/" className="brand">
        <span className="brand-mark">TSO</span>
        <span className="brand-text">Ford Service Manual <small>2000–2004</small></span>
      </Link>
      <JumpToId />
      <button className="help-btn" onClick={() => setHelp(true)}>🤖 Как пользоваться с ИИ-агентом</button>
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
