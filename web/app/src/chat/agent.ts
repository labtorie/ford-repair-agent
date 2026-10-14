// Browser-side manual agent: few LLM requests per question (free tiers allow ~50/day).
//   1. plan    (LLM)  question → English search queries
//   2. search  (code) full-text search over the car's books, rank fusion, follow "GO to" links
//   3. answer  (LLM)  strictly from the retrieved chunks, [ID] citations, verbatim quotes for critical values
//   4. check   (code) every quote must occur verbatim in its cited chunk; every [ID] must be a retrieved chunk
//   5. verify  (LLM)  independent claim-by-claim review against the cited chunks
//   6. revise  (LLM)  only if 4/5 found problems; then the code checks run again
import { loadSearch, type SearchDoc } from '../data'
import { search } from '../search'
import { complete, parseJson, type Msg } from './llm'

export type Car = { model: string; year: string }
export type QuoteCheck = { quote: string; id: string; ok: boolean }
export type Issue = { claim: string; status: string; fix?: string }
export type AgentResult = {
  answer: string
  sources: SearchDoc[]            // chunks given to the model
  cited: string[]                 // ids cited in the final answer
  quotes: QuoteCheck[]
  badIds: string[]                // cited ids that were not among the sources
  issues: Issue[]                 // verifier findings on the draft
  revised: boolean
  requests: number
  queries: string[]
}
export type Progress = { stage: string; detail?: string }

const CTX_CHARS = 36000
const CHUNK_CHARS = 5000
const ID_RE = /\[([A-Z0-9]+\/[a-z0-9_-]+(?:#[A-Za-z0-9_-]+)?(?:[.~]\d+)?)\]/g
const QUOTE_RE = /(?:"([^"\n]{6,400})"|“([^”\n]{6,400})”|«([^»\n]{6,400})»)\s*\[([A-Z0-9]+\/[^\]\s]+)\]/g

const norm = (s: string) => s.replace(/\*\*/g, '').replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/[\s|]+/g, ' ').trim().toLowerCase()

function typeOfBook(books: Record<string, string[]>, b: string) {
  for (const [t, bs] of Object.entries(books)) if (bs.includes(b)) return t
  return ''
}

// English labels: the model reads an all-English context
const TYPE_EN: Record<string, string> = {
  SERVICE: 'Workshop Manual', PCED: 'PCED (powertrain diagnosis)', EVTM: 'Wiring Diagrams', BODYREP: 'Body Repair',
  TSB: 'Technical Service Bulletin', RECALL: 'Recall', CALIB: 'Calibration',
}

function header(d: SearchDoc, type: string) {
  return [`[${d[0]}]`, TYPE_EN[type] ?? type, d[3], d[1], d[2] !== d[1] ? d[2] : ''].filter(Boolean).join(' | ')
}

/** Topic family used to drop off-topic stragglers: workshop/body manual section group (e.g. "307"), all of PCED as one. */
function family(doc: SearchDoc, type: string): string | null {
  if (type === 'SERVICE' || type === 'BODYREP') return doc[3].match(/^(\d{3})-/)?.[1] ?? null
  if (type === 'PCED') return 'PCED'
  return null // TSB / recall / wiring are never filtered
}

// ---------------------------------------------------------------- 1. plan
async function plan(model: string, car: Car, question: string, signal?: AbortSignal): Promise<{ queries: string[]; types: string[] }> {
  const sys = `You help search the Ford ${car.year} ${car.model} service manual (US English, Ford terminology).
Turn the mechanic's question (any language) into 3-6 short English keyword search queries.
Rules: use Ford service terms (e.g. "torque", "removal and installation", "pinpoint test", "symptom chart", "specifications"),
component names, DTC codes as written (P0171), engine sizes (5.4L). 2-5 words per query, no punctuation.
Also pick which document types to search: SERVICE (workshop manual: procedures, specs, torque, diagnosis),
PCED (powertrain DTC / engine electronic diagnosis), EVTM (wiring: connectors, pins, wire colors, fuses),
BODYREP (body panels), TSB (known issues, service bulletins), RECALL.
Reply with JSON only: {"queries": ["..."], "types": ["SERVICE", ...]}`
  const out = await complete(model, [{ role: 'system', content: sys }, { role: 'user', content: question }], { json: true, signal, maxTokens: 400 })
  const j = parseJson<{ queries?: string[]; types?: string[] }>(out)
  const queries = (j?.queries ?? []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 6)
  const types = (j?.types ?? []).filter((t) => typeof t === 'string').map((t) => t.toUpperCase())
  if (!queries.length) queries.push(question.replace(/[^\w\s.-]/g, ' '))
  return { queries, types: types.length ? [...new Set([...types, 'TSB'])] : ['SERVICE', 'PCED', 'EVTM', 'TSB'] }
}

// ---------------------------------------------------------------- 2. retrieve
async function retrieve(books: Record<string, string[]>, queries: string[], types: string[]) {
  const list = Object.entries(books).filter(([t]) => types.includes(t) && t !== 'CALIB').flatMap(([, bs]) => bs)
  const fused = new Map<string, { doc: SearchDoc; book: string; score: number }>()
  for (const q of queries) {
    let words = q.split(/\s+/).filter(Boolean)
    let res = await search(list, words.join(' '), 25)
    // relax: drop the last word until something matches (AND search)
    while (!res.hits.length && words.length > 1) { words = words.slice(0, -1); res = await search(list, words.join(' '), 25) }
    res.hits.forEach((h, rank) => {
      const cur = fused.get(h.doc[0]) ?? { doc: h.doc, book: h.book, score: 0 }
      cur.score += 1 / (8 + rank)
      fused.set(h.doc[0], cur)
    })
  }
  let ranked = [...fused.values()].sort((a, b) => b.score - a.score)
  // If one topic clearly dominates the top results, drop single off-topic hits from other sections
  // (e.g. "instrument cluster" showing up for a transmission DTC).
  const fam = (r: { doc: SearchDoc; book: string }) => family(r.doc, typeOfBook(books, r.book))
  const top = ranked.slice(0, 8).map(fam)
  const counts = new Map<string, number>()
  for (const f of top) if (f) counts.set(f, (counts.get(f) ?? 0) + 1)
  const [dominant, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  if (dominant && n >= 4) {
    const pool = ranked.slice(0, 14).map(fam)
    ranked = ranked.filter((r) => {
      const f = fam(r)
      return !f || f === dominant || pool.filter((x) => x === f).length > 1
    })
  }
  const picked: { doc: SearchDoc; book: string }[] = []
  let size = 0
  const take = (doc: SearchDoc, book: string) => {
    if (picked.some((p) => p.doc[0] === doc[0])) return
    const len = Math.min(doc[4].length, CHUNK_CHARS) + 200
    if (size + len > CTX_CHARS) return
    picked.push({ doc, book }); size += len
  }
  for (const r of ranked.slice(0, 8)) take(r.doc, r.book)
  // follow "GO to …" / "REFER to …" links of the top chunks (pinpoint test steps continue elsewhere)
  for (const p of picked.slice(0, 3)) {
    const targets = [...p.doc[4].matchAll(/\(→([a-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?\)/g)].slice(0, 6)
    for (const [, page, anchor] of targets) {
      const docs = await loadSearch(p.book).catch(() => [] as SearchDoc[])
      const d = docs.find((x) => x[0] === `${p.book}/${page}${anchor ? '#' + anchor : ''}`) ??
        (anchor ? docs.find((x) => x[0].startsWith(`${p.book}/${page}#`) && anchor.startsWith(x[0].split('#')[1])) : undefined)
      if (d) take(d, p.book)
    }
  }
  for (const r of ranked.slice(8, 14)) take(r.doc, r.book)
  return picked.map((p) => ({ ...p, type: typeOfBook(books, p.book) }))
}

// ---------------------------------------------------------------- 3/6. answer & revise
function answerSystem(car: Car) {
  return `You are a Ford service-manual assistant for a ${car.year} ${car.model}.
STRICT RULES:
- Use ONLY the SOURCES given below. Your own automotive knowledge is NOT a source. Never guess.
- Every factual sentence ends with the citation of its source in square brackets, exactly as given, e.g. [S31/s3160021].
  Only cite IDs that appear in SOURCES.
- Critical values (torque, pressure, clearance, fluid spec/capacity, pin/circuit number, wire color, DTC definition,
  pinpoint-test step decision) MUST be accompanied by a verbatim English quote copied character-for-character from the source,
  in double quotes, directly followed by its ID: "Tighten to 37 Nm (27 lb-ft)." [S31/s3160021]
- Keep the manual's step order and step numbers (A1, A2… / H41…). Mention engine/drive variants if the source splits by them.
- If the sources do not answer (part of) the question, say explicitly: "В мануале не найдено: …" (in the user's language).
- Answer in the language of the user's question. Use Markdown: a short **Кратко** section, then **Подробно** (steps/specs),
  then **Предупреждения** (WARNING/CAUTION/NOTE from the sources) if any. Do not list sources at the end.`
}

function sourcesBlock(src: { doc: SearchDoc; type: string }[]) {
  return 'SOURCES:\n\n' + src.map((s) => `### ${header(s.doc, s.type)}\n${s.doc[4].slice(0, CHUNK_CHARS)}`).join('\n\n')
}

// ---------------------------------------------------------------- 4. deterministic checks
export function checkAnswer(answer: string, sources: SearchDoc[], lookup: Map<string, SearchDoc>) {
  const ids = new Set(sources.map((s) => s[0]))
  const cited = [...new Set([...answer.matchAll(ID_RE)].map((m) => m[1]))]
  const badIds = cited.filter((id) => !ids.has(id))
  const quotes: QuoteCheck[] = []
  for (const m of answer.matchAll(QUOTE_RE)) {
    const quote = m[1] ?? m[2] ?? m[3]
    const id = m[4]
    const doc = lookup.get(id)
    quotes.push({ quote, id, ok: !!doc && norm(doc[4]).includes(norm(quote)) })
  }
  return { cited, badIds, quotes }
}

// ---------------------------------------------------------------- 5. verify
async function verify(model: string, car: Car, question: string, answer: string, src: { doc: SearchDoc; type: string }[], signal?: AbortSignal): Promise<Issue[]> {
  const sys = `You are a strict fact-checker. Check the DRAFT answer about a ${car.year} ${car.model} against the SOURCES only
(your own knowledge is not evidence). Split the draft into atomic claims. Report ONLY problems:
UNSUPPORTED (cited source doesn't say it), CONTRADICTED, MISQUOTED (number/quote differs), NO_CITATION (factual claim without [ID]),
WRONG_VEHICLE (source is for another model/engine/variant), MISSING_WARNING (important WARNING/CAUTION of the procedure omitted).
Reply with JSON only: {"issues": [{"claim": "short claim", "status": "UNSUPPORTED", "fix": "what the source actually says, with its [ID]"}]}
Return {"issues": []} if everything is supported.`
  const out = await complete(model, [
    { role: 'system', content: sys },
    { role: 'user', content: `${sourcesBlock(src)}\n\nQUESTION: ${question}\n\nDRAFT:\n${answer}` },
  ], { json: true, signal, maxTokens: 1200 })
  const j = parseJson<{ issues?: Issue[] }>(out)
  return (j?.issues ?? []).filter((i) => i && typeof i.claim === 'string')
}

// ---------------------------------------------------------------- pipeline
export async function runAgent(o: {
  model: string; car: Car; books: Record<string, string[]>; question: string
  onProgress: (p: Progress) => void; onToken: (t: string, reset?: boolean) => void; signal?: AbortSignal; verifyPass?: boolean
}): Promise<AgentResult> {
  let requests = 0
  o.onProgress({ stage: 'План поиска' })
  const p = await plan(o.model, o.car, o.question, o.signal); requests++
  o.onProgress({ stage: 'Поиск по мануалу', detail: p.queries.join(' · ') })
  const src = await retrieve(o.books, p.queries, p.types)
  const lookup = new Map(src.map((s) => [s.doc[0], s.doc]))
  if (!src.length) {
    return { answer: 'В мануале не найдено фрагментов по этому вопросу. Попробуйте переформулировать (названия деталей, код ошибки, симптом).', sources: [], cited: [], quotes: [], badIds: [], issues: [], revised: false, requests, queries: p.queries }
  }
  o.onProgress({ stage: 'Ответ', detail: `источников: ${src.length}` })
  const msgs: Msg[] = [
    { role: 'system', content: answerSystem(o.car) },
    { role: 'user', content: `${sourcesBlock(src)}\n\nQUESTION: ${o.question}` },
  ]
  let answer = await complete(o.model, msgs, { onToken: (t) => o.onToken(t), signal: o.signal }); requests++
  let chk = checkAnswer(answer, src.map((s) => s.doc), lookup)
  let issues: Issue[] = []
  if (o.verifyPass !== false) {
    o.onProgress({ stage: 'Проверка', detail: `цитат: ${chk.quotes.length}, ссылок: ${chk.cited.length}` })
    const cited = src.filter((s) => chk.cited.includes(s.doc[0]))
    issues = await verify(o.model, o.car, o.question, answer, cited.length ? cited : src, o.signal); requests++
  }
  const badQuotes = chk.quotes.filter((q) => !q.ok)
  let revised = false
  if (issues.length || badQuotes.length || chk.badIds.length) {
    o.onProgress({ stage: 'Исправление', detail: `замечаний: ${issues.length + badQuotes.length + chk.badIds.length}` })
    const feedback = [
      ...badQuotes.map((q) => `- MISQUOTED: "${q.quote}" is NOT found verbatim in [${q.id}]. Copy the exact text from the source or remove the claim.`),
      ...chk.badIds.map((id) => `- UNKNOWN ID [${id}] is not one of the SOURCES. Use only given IDs.`),
      ...issues.map((i) => `- ${i.status}: ${i.claim}${i.fix ? ` → ${i.fix}` : ''}`),
    ].join('\n')
    o.onToken('', true)
    answer = await complete(o.model, [...msgs, { role: 'assistant', content: answer },
      { role: 'user', content: `A fact-check of your answer found these problems:\n${feedback}\n\nRewrite the full answer fixing every problem. Same rules and format. Remove anything the sources do not support.` }],
    { onToken: (t) => o.onToken(t), signal: o.signal }); requests++
    revised = true
    chk = checkAnswer(answer, src.map((s) => s.doc), lookup)
  }
  return { answer, sources: src.map((s) => s.doc), cited: chk.cited, quotes: chk.quotes, badIds: chk.badIds, issues, revised, requests, queries: p.queries }
}
