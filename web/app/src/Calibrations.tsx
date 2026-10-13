import { Link } from 'react-router-dom'
import { useCatalog } from './App'

export function Calibrations() {
  const { cat } = useCatalog()
  if (!cat) return <div className="pad muted">Загрузка…</div>
  const rows = cat.calib.map((c) => ({ c, ...cat.docs[c] }))
  return (
    <div className="pad">
      <h1>Калибровки PCM</h1>
      <p className="muted">Таблицы калибровок блока управления двигателем (2000+).</p>
      <table className="docs">
        <thead><tr><th>Книга</th><th>Применимость</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.c}><td><Link to={`/v/${r.c}/_`}>{r.c}</Link></td><td>{r.v.join('; ')}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
