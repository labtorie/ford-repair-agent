import { useEffect, useState } from 'react'
import { loadConfig } from './data'

export function AgentHelp({ onClose }: { onClose: () => void }) {
  const [repo, setRepo] = useState<string | undefined>()
  useEffect(() => { loadConfig().then((c) => setRepo(c.agentRepo)).catch(() => {}) }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Инструкция">
        <button className="modal-x" onClick={onClose} aria-label="Закрыть">×</button>
        <h2>ИИ-ассистент по мануалу</h2>
        <p>
          На сайте можно читать и искать по мануалу самому. А можно задать вопрос ИИ: в чате на сайте
          (бесплатно, со своим ключом OpenRouter) или через агента в <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Claude Code</a>.
          Агент отвечает <b>только по тексту мануала</b>. У каждого утверждения есть ссылка на источник,
          а перед ответом агент сам себя перепроверяет: сверяет цитаты и запускает независимого проверяющего.
        </p>

        <h3>Вариант А: чат прямо на сайте (бесплатно, без установки)</h3>
        <ol>
          <li>Зарегистрируйтесь на <a href="https://openrouter.ai" target="_blank" rel="noreferrer">OpenRouter</a> и
            создайте ключ на странице <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">Keys</a>. Карта не нужна.</li>
          <li>Выберите автомобиль, откройте вкладку <b>«🤖 ИИ-чат»</b>, вставьте ключ и задайте вопрос.</li>
        </ol>
        <p className="muted small">
          Работают бесплатные модели: до 50 запросов в день, один вопрос — 2–4 запроса. Ключ хранится только в вашем
          браузере. Бесплатные модели слабее Claude, поэтому ответ проверяется: цитаты сверяются с мануалом кодом,
          затем модель-проверяющий ищет неподтверждённые утверждения. Результат проверки показан под ответом.
        </p>

        <h2 style={{ marginTop: 22 }}>Вариант Б: агент в Claude Code (надёжнее)</h2>
        <p>Полноценный агент: сам ищет в несколько шагов, ходит по ссылкам между разделами и перепроверяет себя отдельным агентом-проверяющим.</p>
        <h3>1. Установка (один раз): macOS, Linux, Windows</h3>
        <ol>
          <li>Установите Claude Code и войдите в аккаунт. Нужны также Python 3.9+ и git, на Windows — Git for Windows.</li>
          <li>Склонируйте <a href={repo ?? 'https://github.com/labtorie/ford-repair-agent'} target="_blank" rel="noreferrer">репозиторий агента</a> и скачайте поисковый индекс мануала: около 165 МБ, в распакованном виде ~660 МБ.
            Больше ничего ставить не нужно, ISO не требуется.
            <pre>{`git clone ${repo ?? 'https://github.com/labtorie/ford-repair-agent'}.git
cd ford-repair-agent
python3 tools/fetch_index.py`}</pre>
            <span className="muted small">На Windows вместо <code>python3</code> используйте <code>py</code> или <code>python</code>.</span>
          </li>
        </ol>

        <h3>2. Вопрос агенту</h3>
        <p>В папке <code>ford-repair-agent</code> запустите <code>claude</code> и напишите:</p>
        <pre>{`/ford 2003 F-150 5.4L горит check engine, код P0171. Что проверять?
/ford 2002 Explorer 4.0L момент затяжки суппортов передних тормозов`}</pre>
        <p>
          Обязательно укажите <b>год и модель</b>, лучше также двигатель и привод. Вопрос можно писать по-русски:
          агент сам переведёт его в терминологию Ford.
        </p>

        <h3>3. Проверка ответа здесь</h3>
        <p>
          В ответе агента у каждого факта стоит ID источника, например <code>[S31/s31j2002#A]</code> или
          <code>[V22/v225050#pptH41]</code>. Вставьте его в поле <b>«Перейти к ID»</b> в шапке, и откроется
          та самая страница мануала на нужном шаге. Наоборот тоже работает: у каждой страницы и каждого
          фрагмента здесь показан ID, на который можно сослаться в вопросе агенту.
        </p>

        <h3>Что означают ID</h3>
        <ul>
          <li><code>S…</code> — Workshop Manual (например, <code>S31</code> = 2003 F-150), <code>V…</code> — PCED, <code>E…</code> — электросхемы,
            <code>B…</code> — кузов, <code>T…</code> — TSB, <code>R…</code> — отзывные кампании.</li>
          <li>После <code>#</code> идёт якорь внутри страницы: pinpoint-тест (<code>#A</code>) или его шаг (<code>#pptH41</code>).</li>
        </ul>
      </div>
    </div>
  )
}
