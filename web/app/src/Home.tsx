import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCatalog } from './App'
import { loadConfig, type Catalog } from './data'
import { openAgentHelp } from './events'

const REPO_FALLBACK = 'https://github.com/labtorie/ford-repair-agent'

function About({ cat }: { cat: Catalog }) {
  const [repo, setRepo] = useState(REPO_FALLBACK)
  useEffect(() => { loadConfig().then((c) => c.agentRepo && setRepo(c.agentRepo)).catch(() => {}) }, [])
  const n = (t: string) =>
    Object.values(cat.books).filter((b) => b.type === t).length + Object.values(cat.docs).filter((d) => d.type === t).length
  return (
    <section className="about" id="about">
      <h2>О проекте</h2>
      <p>
        Это <b>некоммерческий неофициальный порт</b> сервисной документации Ford, Lincoln и Mercury 2000–2004 модельных годов
        с DVD-программы Ford TSO (Technical Service Online) в обычный веб-интерфейс. Оригинальная программа рассчитана на
        Windows 98/2000/XP с Internet Explorer 6 и хранит документацию в закрытом формате. Здесь те же материалы можно открыть в любом браузере,
        в том числе с телефона: с поиском, оглавлениями и прямыми ссылками на страницы и шаги диагностики.
      </p>
      <ul className="about-stats">
        <li><b>{n('SERVICE')}</b> мануалов по ремонту (Workshop Manual)</li>
        <li><b>{n('EVTM')}</b> книг электросхем (EVTM)</li>
        <li><b>{n('PCED')}</b> книг диагностики двигателя и АКПП (PCED)</li>
        <li><b>{n('BODYREP')}</b> мануалов по кузовному ремонту</li>
        <li><b>{n('TSB')}</b> сервисных бюллетеней и <b>{n('RECALL')}</b> отзывных кампаний (2000+)</li>
      </ul>
      <p>
        Тексты, иллюстрации и схемы показаны в оригинале, на английском, без изменений по существу. Перевода и
        пересказа нет. Для вопросов на русском есть ИИ-ассистенты, которые отвечают строго по этим текстам со ссылками
        на источник: упрощённый чат на сайте и полноценный агент в Claude Code.{' '}
        <button className="linklike" onClick={openAgentHelp}>Как пользоваться</button>
      </p>
      <h3>Важно</h3>
      <ul>
        <li>Проект не связан с Ford Motor Company и не одобрен ею. Права на документацию принадлежат Ford Motor Company,
          названия и марки — их владельцам. Проект ничего не продаёт, рекламы нет, доступ бесплатный.</li>
        <li>Документация актуальна на момент выпуска диска (2005 год). Позднее Ford мог изменить процедуры, детали
          и бюллетени. Для ответственных работ сверяйтесь с действующими источниками производителя.</li>
        <li>Материалы предоставляются «как есть», без каких-либо гарантий. Ремонт выполняется на ваш риск. Соблюдайте
          все WARNING и CAUTION из мануала.</li>
        <li>Если вы правообладатель и хотите, чтобы материалы убрали, или нашли ошибку, напишите в{' '}
          <a href={`${repo}/issues`} target="_blank" rel="noreferrer">issues репозитория</a>.</li>
      </ul>
      <p className="muted small">
        Исходный код сайта, распаковщик формата DVD и ИИ-агент: <a href={repo} target="_blank" rel="noreferrer">{repo.replace('https://', '')}</a>.
      </p>
    </section>
  )
}

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
        <p className="small"><a href="#about" onClick={(e) => { e.preventDefault(); document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' }) }}>О проекте ↓</a></p>
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
      <About cat={cat} />
    </div>
  )
}
