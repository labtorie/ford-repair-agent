import { loadSearch, type SearchDoc } from './data'

export type Hit = { doc: SearchDoc; book: string; score: number; snippet: string }

const norm = (s: string) => s.toLowerCase()

export function tokens(q: string): string[] {
  return (q.toLowerCase().match(/[a-z0-9][a-z0-9./-]*/g) ?? []).filter((t) => t.length > 1 || /\d/.test(t))
}

function count(hay: string, t: string, cap = 6): number {
  let n = 0, i = 0
  while (n < cap && (i = hay.indexOf(t, i)) !== -1) { n++; i += t.length }
  return n
}

function snippet(text: string, toks: string[]): string {
  const low = norm(text)
  let pos = -1
  for (const t of toks) { const i = low.indexOf(t); if (i !== -1 && (pos === -1 || i < pos)) pos = i }
  const start = Math.max(0, pos - 80)
  const s = (start > 0 ? '… ' : '') + text.slice(start, start + 260).replace(/\s+/g, ' ') + (start + 260 < text.length ? ' …' : '')
  return s
}

/** Simple AND search over chunk docs of the given books; title/heading matches weigh more. */
export async function search(books: string[], q: string, limit = 80): Promise<{ hits: Hit[]; total: number }> {
  const toks = tokens(q)
  if (!toks.length) return { hits: [], total: 0 }
  const sets = await Promise.all(books.map((b) => loadSearch(b).then((d) => [b, d] as const).catch(() => [b, []] as const)))
  const hits: Hit[] = []
  for (const [book, docs] of sets) {
    for (const doc of docs) {
      const head = norm(doc[1] + ' ' + doc[2] + ' ' + doc[3])
      const body = norm(doc[4])
      let score = 0
      let ok = true
      for (const t of toks) {
        const h = count(head, t), b = count(body, t)
        if (!h && !b) { ok = false; break }
        score += h * 6 + Math.min(b, 6)
      }
      if (ok) hits.push({ doc, book, score: score / Math.log2(8 + doc[4].length / 400), snippet: '' })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  const top = hits.slice(0, limit)
  for (const h of top) h.snippet = snippet(h.doc[4], toks)
  return { hits: top, total: hits.length }
}

export function highlight(text: string, toks: string[]): (string | { m: string })[] {
  if (!toks.length) return [text]
  const re = new RegExp(`(${toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) => (i % 2 ? { m: part } : part))
}
