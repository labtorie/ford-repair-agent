import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCatalog } from './App'

export function Home() {
  const { cat, err } = useCatalog()
  const [f, setF] = useState('')
  const models = useMemo(() => {
    if (!cat) return []
    const q = f.toLowerCase().replace(/[^a-z0-9]/g, '')
    return cat.models.filter((m) => !q || m.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q))
  }, [cat, f])
  if (err) return <div className="pad error">Не удалось загрузить каталог: {err}</div>
  if (!cat) return <div className="pad muted">Загрузка…</div>
  const years = ['2000', '2001', '2002', '2003', '2004']
  return (
    <div className="home">
      <section className="hero">
        <h1>Выберите автомобиль</h1>
        <p className="muted">
          Мануал по ремонту, диагностика PCED, электросхемы, кузовной ремонт, сервисные бюллетени и отзывные
          кампании Ford, Lincoln и Mercury 2000–2004 модельных годов. Оригинальные тексты на английском.
        </p>
        <input className="filter" placeholder="Фильтр моделей: f150, explorer, focus…" value={f} onChange={(e) => setF(e.target.value)} autoFocus />
      </section>
      <table className="models">
        <thead><tr><th>Модель</th>{years.map((y) => <th key={y}>{y}</th>)}</tr></thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.name}>
              <td className="mname">{m.name}</td>
              {years.map((y) => {
                const yr = m.years[y]
                const has = yr && (yr.SERVICE?.length || yr.EVTM?.length)
                return <td key={y}>{has ? <Link className="ychip" to={`/car/${encodeURIComponent(m.name)}/${y}`}>{y}</Link> : yr ? <Link className="ychip dim" to={`/car/${encodeURIComponent(m.name)}/${y}`} title="Только TSB/PCED">{y}</Link> : <span className="none">·</span>}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Также: <Link to="/calib">калибровки PCM (2000+)</Link>.</p>
    </div>
  )
}
