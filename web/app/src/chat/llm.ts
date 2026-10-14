// Minimal OpenRouter client (OpenAI-compatible). Runs in the browser with the user's own key.

const BASE = 'https://openrouter.ai/api/v1'
const KEY_STORE = 'openrouter_key'
const MODEL_STORE = 'openrouter_model'

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string }
export type FreeModel = { id: string; name: string; ctx: number }

// Preferred defaults among free models (first available wins).
const PREFERRED = [/nemotron-3-super/, /gemma-4-31b/, /nemotron-3-ultra/, /inkling:free$/, /laguna-s/, /gemma/, /nemotron/]

export const store = {
  get key() { try { return localStorage.getItem(KEY_STORE) ?? '' } catch { return '' } },
  set key(v: string) { try { if (v) localStorage.setItem(KEY_STORE, v); else localStorage.removeItem(KEY_STORE) } catch { /* private mode */ } },
  get model() { try { return localStorage.getItem(MODEL_STORE) ?? '' } catch { return '' } },
  set model(v: string) { try { localStorage.setItem(MODEL_STORE, v) } catch { /* private mode */ } },
}

export async function freeModels(): Promise<FreeModel[]> {
  const r = await fetch(`${BASE}/models`)
  if (!r.ok) throw new Error(`OpenRouter models: ${r.status}`)
  const { data } = (await r.json()) as { data: { id: string; name: string; context_length: number; pricing: Record<string, string> }[] }
  const free = data
    .filter((m) => m.id.endsWith(':free') && m.id !== 'openrouter/free')
    .filter((m) => (m.context_length ?? 0) >= 60000)
    .map((m) => ({ id: m.id, name: m.name, ctx: m.context_length }))
  const rank = (id: string) => { const i = PREFERRED.findIndex((re) => re.test(id)); return i === -1 ? 99 : i }
  return free.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
}

export class LlmError extends Error {
  status: number
  constructor(status: number, msg: string) { super(msg); this.status = status }
}

function explain(status: number, body: string): string {
  if (status === 401) return 'Ключ OpenRouter не принят (401). Проверьте ключ в настройках.'
  if (status === 402) return 'OpenRouter: недостаточно средств (402). Выберите бесплатную модель (:free).'
  if (status === 429) return 'Лимит бесплатных запросов OpenRouter исчерпан (20 в минуту / 50 в день). Подождите или выберите другую модель.'
  if (status === 404) return 'Модель недоступна (404). Выберите другую бесплатную модель.'
  return `OpenRouter ${status}: ${body.slice(0, 300)}`
}

/** One chat completion. If onToken is given, streams the answer. */
export async function complete(model: string, messages: Msg[], opts: { json?: boolean; onToken?: (t: string) => void; signal?: AbortSignal; maxTokens?: number } = {}): Promise<string> {
  const key = store.key
  if (!key) throw new LlmError(401, 'Не задан ключ OpenRouter.')
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin + location.pathname,
      'X-Title': 'Ford Service Manual 2000-2004',
    },
    body: JSON.stringify({
      model, messages, temperature: 0.1, max_tokens: opts.maxTokens ?? 2500,
      stream: !!opts.onToken,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new LlmError(r.status, explain(r.status, body))
  }
  if (!opts.onToken) {
    const j = await r.json()
    if (j.error) throw new LlmError(j.error.code ?? 500, explain(j.error.code ?? 500, j.error.message ?? ''))
    return j.choices?.[0]?.message?.content ?? ''
  }
  // SSE stream
  const reader = r.body!.getReader()
  const dec = new TextDecoder()
  let buf = '', out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return out
      try {
        const j = JSON.parse(data)
        if (j.error) throw new LlmError(j.error.code ?? 500, explain(j.error.code ?? 500, j.error.message ?? ''))
        const t = j.choices?.[0]?.delta?.content
        if (t) { out += t; opts.onToken(t) }
      } catch (e) { if (e instanceof LlmError) throw e }
    }
  }
  return out
}

/** Lenient JSON extraction (some free models wrap JSON in prose or code fences). */
export function parseJson<T>(s: string): T | null {
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) as T } catch { return null }
}
