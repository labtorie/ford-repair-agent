// Data access for the static manual export (see web/scripts/build_data.py).

export type TocNode = { t: string; p?: string; c?: TocNode[]; sec?: string }
export type Vehicle = { y: number; m: string; e?: string }
export type Book = {
  code: string; type: string; title: string; vehicles: Vehicle[]; hr: string; date: string
  toc: TocNode[]; seq: string[]; pages: Record<string, number>
}
export type Page = { t: string; h?: string; pdf?: string; s?: string; ss?: string }
export type DocMeta = { type: string; n: string; t: string; d: string; v: string[] }
export type Catalog = {
  models: { name: string; years: Record<string, Record<string, string[]>> }[]
  books: Record<string, { type: string; title: string; veh: string[] }>
  docs: Record<string, DocMeta>
  calib: string[]
}
// [id, title, heading, section, text]
export type SearchDoc = [string, string, string, string, string]
export type Config = { packs: Record<string, string>; agentRepo?: string }

export const TYPE_LABEL: Record<string, string> = {
  SERVICE: 'Мануал по ремонту', PCED: 'PCED (диагностика ДВС/АКПП)', EVTM: 'Электросхемы',
  BODYREP: 'Кузовной ремонт', TSB: 'Сервисные бюллетени (TSB)', RECALL: 'Отзывные кампании', CALIB: 'Калибровки',
}
export const TYPE_SHORT: Record<string, string> = {
  SERVICE: 'Мануал', PCED: 'PCED', EVTM: 'Схемы', BODYREP: 'Кузов', TSB: 'TSB', RECALL: 'Отзыв', CALIB: 'Калибровка',
}

const cache = new Map<string, Promise<unknown>>()

function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const p = fn().catch((e) => { cache.delete(key); throw e })
    cache.set(key, p)
  }
  return cache.get(key) as Promise<T>
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

async function getGz<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`${r.status} ${url}`)
  // Some servers already decode .gz (Content-Encoding); detect gzip magic first.
  const buf = new Uint8Array(await r.arrayBuffer())
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf))
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}

export const loadConfig = () => once('config', () => getJson<Config>('config.json'))
export const loadCatalog = () => once('catalog', () => getJson<Catalog>('data/catalog.json'))
export const loadBook = (b: string) => once(`book:${b}`, () => getJson<Book>(`data/b/${b}/book.json`))
export const loadSearch = (b: string) => once(`s:${b}`, () => getGz<SearchDoc[]>(`data/b/${b}/s.json.gz`))

export async function loadPage(book: string, page: string): Promise<Page | null> {
  const b = await loadBook(book)
  const n = b.pages[page]
  if (n === undefined) return null
  const bundle = await once(`p:${book}:${n}`, () => getGz<Record<string, Page>>(`data/b/${book}/p${n}.json.gz`))
  return bundle[page] ?? null
}

/** Replace "@pack/xx/hash.ext" media tokens with real URLs. */
export function resolveMedia(html: string, cfg: Config): string {
  return html.replace(/(["'])@(\w+)\//g, (_, q, pack) => q + (cfg.packs[pack] ?? `packs/${pack}/m/`))
}
export function mediaUrl(token: string, cfg: Config): string {
  const m = token.match(/^@(\w+)\/(.*)$/)
  return m ? (cfg.packs[m[1]] ?? `packs/${m[1]}/m/`) + m[2] : token
}

/** Agent citation id → route. Accepts "[S31/s31j2002#A]", "S31/s31j2002#A.2", "s31j2002", "V22/v225050#pptH41". */
export function parseId(raw: string): { book?: string; page: string; anchor?: string } | null {
  const s = raw.trim().replace(/^\[|\]$/g, '').replace(/^→/, '').trim()
  const m = s.match(/^(?:([A-Za-z0-9]+)\/)?([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+?))?(?:[.~]\d+)?$/)
  if (!m) return null
  return { book: m[1]?.toUpperCase(), page: m[2].toLowerCase(), anchor: m[3] }
}

/** Find the book of a bare page name (page names start with their book code). */
export async function findBook(page: string): Promise<string | null> {
  const cat = await loadCatalog()
  const all = [...Object.keys(cat.books), ...Object.keys(cat.docs)]
  const cands = all.filter((b) => page.startsWith(b.toLowerCase())).sort((a, b) => b.length - a.length)
  for (const b of cands) {
    try {
      const bk = await loadBook(b)
      if (page in bk.pages) return b
    } catch { /* try next */ }
  }
  return null
}

export function pageRoute(book: string, page: string, anchor?: string, hl?: string) {
  let r = `/v/${book}/${page}`
  if (anchor) r += `/${anchor}`
  if (hl) r += `?hl=${encodeURIComponent(hl)}`
  return r
}

export function idToRoute(id: string, hl?: string) {
  const p = parseId(id)
  if (!p || !p.book) return null
  return pageRoute(p.book, p.page, p.anchor, hl)
}

/** Books relevant for a vehicle year (incl. TSB/recall docs). */
export function carBooks(cat: Catalog, model: string, year: string): Record<string, string[]> {
  const m = cat.models.find((x) => x.name === model)
  return (m?.years[year] ?? {}) as Record<string, string[]>
}
