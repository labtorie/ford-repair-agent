import { useEffect, useMemo, useRef, useState } from 'react'
import { idToRoute } from '../data'
import { runAgent, type AgentResult, type Progress } from './agent'
import { dailyResetLocal, freeModels, keyInfo, store, type FreeModel, type KeyInfo } from './llm'
import { renderMd } from './md'
import { openAgentHelp } from '../events'

type Turn = { q: string; progress: Progress[]; text: string; result?: AgentResult; error?: string; done: boolean }

type Usage = { info: KeyInfo | null; loading: boolean; err: string; reload: () => void }

function UsagePanel({ u }: { u: Usage }) {
  const f = u.info?.free
  return (
    <div className="usage">
      <div className="row">
        <b>Лимиты OpenRouter</b>
        <button className="icon" onClick={u.reload} disabled={u.loading} title="Обновить">↻</button>
        {u.loading && <span className="muted small">проверяю…</span>}
      </div>
      {u.err && <div className="error small">{u.err}</div>}
      {u.info && (
        <>
          {f ? (
            <>
              <div>
                Бесплатные запросы сегодня: <b>{f.used} из {f.limit}</b> · осталось <b>{f.remaining}</b>
                {' '}(≈ {Math.floor(f.remaining / 3)} вопр.)
              </div>
              <div className="bar" aria-hidden><span style={{ width: `${Math.min(100, (f.used / Math.max(1, f.limit)) * 100)}%` }} className={f.remaining < 4 ? 'low' : ''} /></div>
            </>
          ) : (
            <div className="muted small">OpenRouter не сообщил дневной лимит бесплатных запросов для этого ключа.</div>
          )}
          <div className="muted small">
            Сброс в {dailyResetLocal()} по вашему времени (00:00 UTC). Отдельно действует лимит 20 запросов в минуту: OpenRouter его не показывает.
            {u.info.usageDaily > 0 && <> Потрачено кредитов сегодня: ${u.info.usageDaily.toFixed(4)}.</>}
            {u.info.limitRemaining !== null && <> Остаток кредитов на ключе: ${u.info.limitRemaining.toFixed(2)}.</>}
          </div>
        </>
      )}
    </div>
  )
}

function Settings({ onChange, usage }: { onChange: () => void; usage: Usage }) {
  const [key, setKey] = useState(store.key)
  const [edit, setEdit] = useState(!store.key)
  const [models, setModels] = useState<FreeModel[]>([])
  const [model, setModel] = useState(store.model)
  const [err, setErr] = useState('')
  useEffect(() => {
    freeModels().then((ms) => {
      setModels(ms)
      if (!store.model || !ms.some((m) => m.id === store.model)) { store.model = ms[0]?.id ?? ''; setModel(store.model); onChange() }
    }, (e) => setErr(String(e)))
  }, [onChange])
  return (
    <div className="chat-settings">
      {edit ? (
        <form onSubmit={(e) => { e.preventDefault(); store.key = key.trim(); setEdit(!key.trim()); onChange() }}>
          <label>
            Ключ OpenRouter&nbsp;
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-v1-…" autoComplete="off" spellCheck={false} />
          </label>
          <button type="submit">Сохранить</button>
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">Получить бесплатный ключ ↗</a>
        </form>
      ) : (
        <div className="row">
          <span>🔑 Ключ сохранён в этом браузере</span>
          <button onClick={() => setEdit(true)}>Изменить</button>
          <button onClick={() => { store.key = ''; setKey(''); setEdit(true); onChange() }}>Удалить ключ</button>
        </div>
      )}
      {!edit && store.key && <UsagePanel u={usage} />}
      <div className="row">
        <label>
          Модель&nbsp;
          <select value={model} onChange={(e) => { store.model = e.target.value; setModel(e.target.value); onChange() }}>
            {!models.length && <option value="">{err ? 'список недоступен' : 'загрузка моделей…'}</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
          </select>
        </label>
        {err && <span className="error">{err}</span>}
      </div>
      <p className="muted small">
        Бесплатные модели OpenRouter: до 20 запросов в минуту и 50 в день. Один вопрос — 2–4 запроса.
        Ключ хранится только в этом браузере и отправляется только в OpenRouter. Бесплатные модели могут
        логировать запросы у провайдера: не пишите в вопросах личных данных.
      </p>
    </div>
  )
}

function Verification({ r }: { r: AgentResult }) {
  const okQ = r.quotes.filter((q) => q.ok).length
  const bad = r.quotes.filter((q) => !q.ok)
  const clean = !bad.length && !r.badIds.length
  return (
    <details className={`verify ${clean ? 'ok' : 'warn'}`} open={!clean}>
      <summary>
        {clean ? '✓' : '⚠'} Проверка: цитат {okQ}/{r.quotes.length} найдено дословно, ссылок {r.cited.length}
        {r.badIds.length ? `, неизвестных ID: ${r.badIds.length}` : ''}
        {r.revised ? ' · ответ исправлен после проверки' : ''} · запросов к модели: {r.requests}
      </summary>
      {bad.length > 0 && (
        <div><b>Цитаты, которых нет в источнике (не доверяйте этим значениям):</b>
          <ul>{bad.map((q, i) => <li key={i}>"{q.quote}" — [{q.id}]</li>)}</ul>
        </div>
      )}
      {r.badIds.length > 0 && <div><b>Ссылки не на найденные источники:</b> {r.badIds.join(', ')}</div>}
      {r.issues.length > 0 && (
        <div><b>Замечания проверяющего к черновику</b>{r.revised ? ' (учтены в исправленном ответе)' : ''}:
          <ul>{r.issues.map((i, k) => <li key={k}><code>{i.status}</code> {i.claim}{i.fix ? ` → ${i.fix}` : ''}</li>)}</ul>
        </div>
      )}
      <div className="muted small">Поисковые запросы: {r.queries.join(' · ')}</div>
      <div className="small"><b>Источники, переданные модели:</b>
        <ul className="srcs">
          {r.sources.map((d) => (
            <li key={d[0]} className={r.cited.includes(d[0]) ? 'cited' : ''}>
              <a href={`#${idToRoute(d[0]) ?? '/'}`} target="_blank" rel="noreferrer"><code>{d[0]}</code></a> {d[2] || d[1]} <span className="muted">{d[3]}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}

export function Chat({ model, year, books }: { model: string; year: string; books: Record<string, string[]> }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const ready = !!store.key && !!store.model
  const refresh = useMemo(() => () => setTick((t) => t + 1), [])
  const [info, setInfo] = useState<KeyInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoErr, setInfoErr] = useState('')
  const key = store.key
  const reloadInfo = useMemo(() => () => {
    if (!store.key) { setInfo(null); return }
    setInfoLoading(true); setInfoErr('')
    keyInfo().then(setInfo, (e) => setInfoErr((e as Error).message)).finally(() => setInfoLoading(false))
  }, [])
  useEffect(() => { reloadInfo() }, [key, reloadInfo])
  const usage: Usage = { info, loading: infoLoading, err: infoErr, reload: reloadInfo }
  const remaining = info?.free?.remaining

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [turns])
  useEffect(() => () => abort.current?.abort(), [])

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    const question = q.trim()
    if (!question || busy || !ready) return
    setQ('')
    setBusy(true)
    abort.current = new AbortController()
    const idx = turns.length
    const upd = (f: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, i) => (i === idx ? f(t) : t)))
    setTurns((ts) => [...ts, { q: question, progress: [], text: '', done: false }])
    try {
      const result = await runAgent({
        model: store.model, car: { model, year }, books, question, signal: abort.current.signal,
        onProgress: (p) => upd((t) => ({ ...t, progress: [...t.progress, p] })),
        onToken: (tok, reset) => upd((t) => ({ ...t, text: reset ? '' : t.text + tok })),
      })
      upd((t) => ({ ...t, text: result.answer, result, done: true }))
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'AbortError' ? 'Остановлено.' : (err as Error).message
      upd((t) => ({ ...t, error: msg, done: true }))
    } finally {
      setBusy(false)
      reloadInfo()
    }
  }

  return (
    <div className="chat">
      <div className="chat-disclaimer">
        <b>Это упрощённый вспомогательный режим, а не основной способ работы с мануалом.</b> Бесплатные модели слабее
        и могут ошибаться даже с проверкой: всегда открывайте источник по ссылке и сверяйтесь с текстом мануала.
        Для надёжных ответов настройте ИИ-агента локально в Claude Code: он ищет в несколько шагов, ходит по
        ссылкам между разделами и перепроверяет себя отдельным агентом.{' '}
        <button className="linklike" onClick={openAgentHelp}>Как настроить агента →</button>
      </div>
      <Settings onChange={refresh} usage={usage} />
      <div className="turns">
        {turns.length === 0 && (
          <div className="muted chat-empty">
            Задайте вопрос по {year} {model}: например, «момент затяжки суппортов передних тормозов» или
            «горит check engine, код P0171 — что проверять». Ответ строится только по мануалу,
            у каждого факта есть ссылка на источник: она откроется в новой вкладке.
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="turn">
            <div className="q">{t.q}</div>
            <div className="a">
              {!t.done && (
                <ol className="steps">
                  {t.progress.map((p, k) => <li key={k} className={k === t.progress.length - 1 ? 'cur' : ''}>{p.stage}{p.detail ? <span className="muted"> — {p.detail}</span> : null}</li>)}
                </ol>
              )}
              {t.text && <div className="md" dangerouslySetInnerHTML={{ __html: renderMd(t.text) }} />}
              {t.error && <div className="error">{t.error}</div>}
              {t.result && <Verification r={t.result} />}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {ready && remaining !== undefined && remaining < 4 && (
        <div className="usage-warn">
          {remaining === 0
            ? `Бесплатные запросы на сегодня закончились. Лимит обновится в ${dailyResetLocal()}.`
            : `Бесплатных запросов осталось: ${remaining}, а один вопрос тратит 2–4. Ответ может оборваться на середине.`}
        </div>
      )}
      <form className="ask" onSubmit={ask}>
        <textarea
          value={q} onChange={(e) => setQ(e.target.value)} rows={2}
          placeholder={ready ? `Вопрос по ${year} ${model} (можно по-русски)…` : 'Сначала сохраните ключ OpenRouter'}
          disabled={!ready}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e) } }}
        />
        {busy
          ? <button type="button" onClick={() => abort.current?.abort()}>Стоп</button>
          : <button type="submit" disabled={!ready || !q.trim()}>Спросить</button>}
      </form>
    </div>
  )
}
