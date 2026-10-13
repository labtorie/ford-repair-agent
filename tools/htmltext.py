"""Convert Ford TSO manual HTML pages into plain text sections.

Each page is split at <h4>/<h5> headings and at anchors <a name=...>, so that
citations can point to e.g. "S31/s31j2002#A" (Pinpoint Test A) or "#A2" (step).
"""
import html
import re
from html.parser import HTMLParser

BLOCK = {"p", "div", "br", "tr", "li", "ul", "ol", "table", "caption", "h1", "h2",
         "h3", "h4", "h5", "h6", "hr", "dl", "dt", "dd", "center", "blockquote"}
SKIP = {"script", "style", "title"}

_FRAME = re.compile(r"rightside=([^&\"']+)", re.I)


def norm_href(href: str) -> str:
    """Return 'page#anchor' (lowercase page w/o .htm) for in-manual links, '' otherwise."""
    href = html.unescape(href)
    m = _FRAME.search(href)
    if m:
        href = m.group(1)
    if href.startswith(("http", "mailto", "javascript")) or "asp" in href.lower():
        return ""
    page, _, anchor = href.partition("#")
    page = page.rsplit("/", 1)[-1]
    page = re.sub(r"\.htm$", "", page, flags=re.I).lower()
    return page + ("#" + anchor if anchor else "")


class _Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.parts = []          # list of (kind, value): ("text", s) / ("anchor", name) / ("head", level)
        self.skip = 0
        self.href = None
        self.link_text = []
        self.cell = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in SKIP:
            self.skip += 1
            return
        if tag == "meta" and a.get("name", "").startswith("tps_"):
            self.meta[a["name"][4:]] = (a.get("content") or "").strip()
            return
        if tag == "a":
            if a.get("name"):
                self.parts.append(("anchor", a["name"]))
            if a.get("href"):
                self.href = norm_href(a["href"])
                self.link_text = []
            return
        if tag == "img" and a.get("src"):
            src = a["src"].rsplit("/", 1)[-1]
            self.parts.append(("text", f" [Figure {src}] "))
            return
        if tag in ("td", "th"):
            self.parts.append(("text", " | " if self.cell else ""))
            self.cell += 1
            return
        if tag == "tr":
            self.cell = 0
        if tag in ("h4", "h5"):
            self.parts.append(("head", tag))
        if tag == "li":
            self.parts.append(("text", "\n- "))
            return
        if tag == "b" or tag == "strong":
            self.parts.append(("text", "**"))
            return
        if tag in BLOCK:
            self.parts.append(("text", "\n"))

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if tag == "a" and self.href is not None:
            if self.href:
                self.parts.append(("text", f" (→{self.href})"))
            self.href = None
            return
        if tag == "b" or tag == "strong":
            self.parts.append(("text", "**"))
            return
        if tag in ("h4", "h5"):
            self.parts.append(("endhead", tag))
        if tag in BLOCK:
            self.parts.append(("text", "\n"))

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(("text", re.sub(r"\s+", " ", data)))


def _clean(s: str) -> str:
    s = s.replace("\xa0", " ").replace("\r", "")
    s = re.sub(r"\*\*\s*\*\*", "", s)
    s = re.sub(r"\*\*(\s*)([^*]*?)(\s*)\*\*", lambda m: f"{m.group(1)}**{m.group(2)}**{m.group(3)}" if m.group(2).strip() else m.group(1), s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n(\| )+", "\n", s)
    s = re.sub(r"(?m)^[\s|\-]*$", "", s)  # lines with only table bars / empty bullets
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def parse(raw: str):
    """Return (meta, sections); sections = [{'anchor', 'heading', 'text'}]."""
    p = _Parser()
    p.feed(raw)
    p.close()
    sections = []
    cur = {"anchor": "", "heading": "", "buf": []}
    pending_anchor = None
    in_head = None
    head_buf = []

    def flush(new_anchor, new_heading):
        nonlocal cur
        txt = _clean("".join(cur["buf"]))
        if txt:
            sections.append({"anchor": cur["anchor"], "heading": cur["heading"], "text": txt})
        cur = {"anchor": new_anchor, "heading": new_heading, "buf": []}

    for kind, val in p.parts:
        if kind == "anchor":
            pending_anchor = val
        elif kind == "head":
            in_head = val
            head_buf = []
        elif kind == "endhead":
            heading = _clean("".join(head_buf)).strip("* ")
            anchor = pending_anchor or cur["anchor"]
            flush(anchor, heading)
            cur["buf"].append(f"\n## {heading}\n")
            in_head = None
            pending_anchor = None
        elif in_head:
            head_buf.append(val)
        else:
            cur["buf"].append(val)
    flush("", "")
    return p.meta, sections


def page_text(raw: str) -> str:
    meta, secs = parse(raw)
    return "\n\n".join(s["text"] for s in secs)
