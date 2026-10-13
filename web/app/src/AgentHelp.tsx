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
        <h2>ИИ-агент по мануалу</h2>
        <p>
          Этот сайт — просто навигатор по мануалу. Поиск с ответами делает ИИ-агент, он работает
          локально в <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Claude Code</a>.
          Агент отвечает <b>только по тексту мануала</b>. У каждого утверждения есть ссылка на источник,
          а перед ответом агент сам себя перепроверяет: сверяет цитаты и запускает независимого проверяющего.
        </p>

        <h3>1. Установка (один раз)</h3>
        <ol>
          <li>Установите Claude Code и войдите в аккаунт. Нужен Python 3.9 или новее, на Windows также Git for Windows (Claude Code работает через Git Bash).</li>
          <li>
            {repo
              ? <>Склонируйте репозиторий агента <a href={repo} target="_blank" rel="noreferrer">{repo}</a> и положите в его корень </>
              : <>Возьмите папку проекта агента (<code>tools/</code>, <code>.claude/</code>, <code>CLAUDE.md</code>) и положите в её корень </>}
            ISO <code>2000_2004 Ford Car Service Manual.iso</code>.
          </li>
          <li>В корне проекта распакуйте мануал и постройте поисковый индекс. Это займёт несколько минут, на диске понадобится около 7 ГБ.
            <p><b>macOS / Linux:</b></p>
            <pre>{`mkdir -p raw
tar -xf "2000_2004 Ford Car Service Manual.iso" -C raw CONTENT/USENI4
python3 -m venv .venv && .venv/bin/pip install pypdf
.venv/bin/python tools/extract_all.py         # формат POD BAY → out/USENI4
.venv/bin/python tools/build_index.py         # индекс → index/manual.db
rm -rf raw                                    # больше не нужна`}</pre>
            <span className="muted small">На macOS <code>tar</code> читает ISO. На Linux поставьте <code>libarchive-tools</code> и используйте <code>bsdtar</code>.</span>
            <p><b>Windows (PowerShell):</b> откройте ISO двойным кликом. Он подключится как диск, например <code>E:</code>. Затем:</p>
            <pre>{`py -m venv .venv
.venv\Scripts\pip install pypdf
.venv\Scripts\python tools\extract_all.py E:\CONTENT\USENI4 out\USENI4
.venv\Scripts\python tools\build_index.py`}</pre>
          </li>
        </ol>

        <h3>2. Вопрос агенту</h3>
        <p>В папке проекта запустите <code>claude</code> и напишите:</p>
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
