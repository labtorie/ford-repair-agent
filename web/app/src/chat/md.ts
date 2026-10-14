// Tiny Markdown → HTML for model output. Everything is HTML-escaped first, so model text can't inject markup;
// only our own tags are added. [ID] citations become links to the viewer (new tab, so the chat stays open).
import { idToRoute } from '../data'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s: string) {
  let h = esc(s)
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  h = h.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:]|$)/g, '$1<i>$2</i>')
  h = h.replace(/\[([A-Z0-9]+\/[a-z0-9_-]+(?:#[A-Za-z0-9_-]+)?(?:[.~]\d+)?)\]/g, (m, id: string) => {
    const r = idToRoute(id)
    return r ? `<a class="cite" href="#${r}" target="_blank" rel="noreferrer" title="Открыть источник">${id}</a>` : m
  })
  return h
}

export function renderMd(src: string): string {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  const close = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    let m
    if (!line.trim()) { close(); continue }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { close(); out.push(`<h4>${inline(m[2])}</h4>`); continue }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul' } out.push(`<li>${inline(m[1])}</li>`); continue }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push(`<ol start="${m[1]}">`); list = 'ol' } out.push(`<li>${inline(m[2])}</li>`); continue }
    if ((m = line.match(/^>\s?(.*)$/))) { close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue }
    close()
    out.push(`<p>${inline(line)}</p>`)
  }
  close()
  return out.join('\n')
}
