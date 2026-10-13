"""Build static data for the web viewer from out/USENI4 + index/manual.db.

Output (web/build/):
  public/data/catalog.json            models → years → books, book list, TSB/recall metadata
  public/data/b/<BOOK>/book.json      TOC tree + page→bundle map
  public/data/b/<BOOK>/p<N>.json.gz   page bundles {page: {t, h|pdf}}
  public/data/b/<BOOK>/s.json.gz      search docs [[id, title, heading, section, text]]
  packs/<pack>/m/xx/<hash>.<ext>      content-addressed media (hard links), pack = main|fig|wd

Image/PDF references inside page HTML are written as "@<pack>/xx/hash.ext"; the app
replaces "@<pack>/" with the pack base URL from config.json.
"""
import collections
import csv
import glob
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from html import escape, unescape
from html.parser import HTMLParser
import multiprocessing

Pool = multiprocessing.get_context("fork").Pool  # workers must inherit Ctx tables

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "out", "USENI4")
DB = os.path.join(ROOT, "index", "manual.db")
OUT = os.path.join(ROOT, "web", "build")
DATA = os.path.join(OUT, "public", "data")
PACKS = os.path.join(OUT, "packs")

MIN_YEAR = 2000
BUNDLE_BYTES = 400_000  # raw html per bundle (before gzip)
PACK_OF = {"SERVICE": "fig", "EVTM": "wd"}  # everything else -> main
SSTYPE_ORDER = ["spec", "descop", "diagtest", "genproc", "invehic", "reminst", "disasmbl", "assembly", "instl"]
EVTM_CELLTYPE = {"COD": "Introduction", "SCH": "Schematics", "LOC": "Component Locations", "CON": "Connector Views",
                 "CNV": "Connector Views", "PWR": "Power Distribution", "GRD": "Grounds", "SPL": "Splices",
                 "HAR": "Harness", "FUS": "Fuse Details", "IDX": "Index", "CPT": "Component Testing", "TST": "Component Testing"}


def xml_info(book):
    p = os.path.join(SRC, book, book.lower() + ".xml")
    if not os.path.exists(p):
        return {"type": "", "title": "", "vehicles": []}
    s = open(p, encoding="cp1252", errors="replace").read()
    g = lambda t: unescape((re.search(rf"<{t}>(.*?)</{t}>", s, re.S) or [None, ""])[1].strip())  # noqa: E731
    veh = []
    for m in re.finditer(r"<vehicle>(.*?)</vehicle>", s, re.S):
        y = re.search(r"<year>(\d+)</year>", m.group(1))
        n = re.search(r"<name>([^<]*)</name>", m.group(1))
        e = re.search(r"<engine>([^<]*)</engine>", m.group(1))
        if y and n:
            veh.append({"y": int(y.group(1)), "m": unescape(n.group(1)).strip(), "e": e.group(1).strip() if e else ""})
    return {"type": g("type"), "title": re.sub(r"\s+", " ", g("title")), "hr": g("hr_name"),
            "date": g("prod_date"), "vehicles": veh}


def included(info):
    t = info["type"]
    if t in ("SERVICE", "PCED", "EVTM", "BODYREP"):
        return True
    if t in ("TSB", "RECALL", "CALIB"):
        return any(v["y"] >= MIN_YEAR for v in info["vehicles"])
    return False


def key(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


# ---------------------------------------------------------------- HTML sanitizer
KEEP_TAGS = {"a", "b", "i", "u", "strong", "em", "p", "br", "div", "span", "table", "thead", "tbody", "tfoot", "tr",
             "td", "th", "caption", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "img", "hr", "center", "sup",
             "sub", "pre", "dl", "dt", "dd", "blockquote", "small", "big", "tt", "code", "col", "colgroup"}
KEEP_ATTRS = {"colspan", "rowspan", "align", "valign", "width", "height", "border", "cellpadding", "cellspacing",
              "class", "alt", "type", "start", "bgcolor", "nowrap"}
DROP_CONTENT = {"script", "style", "title", "head", "noscript", "object", "embed", "applet", "frameset"}
VOID = {"br", "hr", "img", "col"}


class Sanitizer(HTMLParser):
    def __init__(self, link_fn, img_fn):
        super().__init__(convert_charrefs=False)
        self.out = []
        self.drop = 0
        self.link_fn, self.img_fn = link_fn, img_fn
        self.a_stack = []
        self.anchors = []

    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.drop = 0
            return
        if tag in DROP_CONTENT:
            if tag != "head" or not self.drop:
                self.drop += 1
            return
        if self.drop or tag not in KEEP_TAGS:
            return
        a = dict(attrs)
        kept = []
        for k, v in attrs:
            if k in KEEP_ATTRS and v is not None and not (k == "width" and tag in ("td", "th") and "%" not in v):
                kept.append((k, v))
        if tag == "a":
            name = a.get("name")
            href = a.get("href")
            kept = []
            if name:
                kept.append(("id", "a-" + name))
                self.anchors.append(name)
            if href:
                h = self.link_fn(href)
                if h is None:
                    self.a_stack.append(False)
                    if name:
                        self.out.append(f'<a id="a-{escape(name)}"></a>')
                    return
                kept.append(("href", h))
                if h.startswith("@"):
                    kept.append(("data-media", "1"))
            self.a_stack.append(True)
        if tag == "img":
            src = self.img_fn(a.get("src") or "")
            if not src:
                return
            kept = [(k, v) for k, v in kept if k in ("alt", "width", "height", "border")] + [("src", src), ("loading", "lazy")]
        attr = "".join(f' {k}="{escape(v, quote=True)}"' for k, v in kept)
        self.out.append(f"<{tag}{attr}>")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag == "a" and self.a_stack:
            self.handle_endtag("a")

    def handle_endtag(self, tag):
        if tag in DROP_CONTENT:
            self.drop = max(0, self.drop - 1)
            return
        if tag == "head":
            return
        if self.drop or tag not in KEEP_TAGS or tag in VOID:
            return
        if tag == "a":
            if not self.a_stack:
                return
            if not self.a_stack.pop():
                return
        self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.drop:
            self.out.append(data)

    def handle_entityref(self, name):
        if not self.drop:
            self.out.append(f"&{name};")

    def handle_charref(self, name):
        if not self.drop:
            self.out.append(f"&#{name};")


_FRAME = re.compile(r"rightside=([^&\"']+)", re.I)


class Ctx:
    """Shared lookup tables (built once in the parent, inherited by workers)."""
    page_book = {}      # page name (lower, no ext) -> book
    nav_target = {}     # nav page -> (book, page) of first content page in that section
    media = {}          # (book, filename lower) -> "@pack/xx/hash.ext"


def make_link_fn(book):
    def fn(href):
        href = unescape(href).strip()
        if href.lower().startswith(("javascript", "mailto", "http")):
            return None
        m = _FRAME.search(href)
        if m:
            href = m.group(1)
        elif ".asp" in href.lower():
            return None
        if href.startswith("#"):
            return None if len(href) < 2 else f"#a:{href[1:]}"
        page, _, anchor = href.partition("#")
        fname = page.rsplit("/", 1)[-1].lower()
        stem, ext = os.path.splitext(fname)
        if ext in (".pdf", ".gif", ".jpg", ".svgz", ".swf"):
            b = Ctx.page_book.get(stem, book)
            return Ctx.media.get((b, fname))
        if stem in Ctx.nav_target:
            b, p = Ctx.nav_target[stem]
            return f"#/v/{b}/{p}"
        b = Ctx.page_book.get(stem)
        if not b:
            return None
        return f"#/v/{b}/{stem}" + (f"/{anchor}" if anchor else "")
    return fn


def make_img_fn(book):
    def fn(src):
        name = src.rsplit("/", 1)[-1].lower()
        return Ctx.media.get((book, name))
    return fn


def sanitize(raw, book):
    s = Sanitizer(make_link_fn(book), make_img_fn(book))
    s.feed(raw)
    s.close()
    h = "".join(s.out)
    h = re.sub(r"(<p>\s*&nbsp;\s*</p>\s*|<p>\s*</p>\s*){2,}", "", h, flags=re.I)
    h = re.sub(r"\n\s*\n+", "\n", h)
    return h.strip(), s.anchors


def meta_of(raw):
    return {m.group(1).lower(): unescape(m.group(2)).strip()
            for m in re.finditer(r'<meta\s+name="tps_(\w+)"\s+content="([^"]*)"', raw, re.I)}


def title_of(raw):
    m = re.search(r"<title>(.*?)</title>", raw, re.S | re.I)
    return re.sub(r"\s+", " ", unescape(m.group(1))).strip() if m else ""


def read(path):
    return open(path, encoding="cp1252", errors="replace").read()


# ---------------------------------------------------------------- TOC builders
def links_in(raw):
    return [(unescape(re.sub(r"<[^>]+>", "", t)).strip(), h)
            for h, t in re.findall(r'<a[^>]+href="?([^" >]+)"?[^>]*>(.*?)</a>', raw, re.S | re.I)]


def toc_service(book, pages):
    """pages: {page: {'meta', 'title'}} → tree system/group/section/sstype/page."""
    d = os.path.join(SRC, book)
    sysname, grpname = {}, {}
    left = os.path.join(d, book.lower() + "left.htm")
    if os.path.exists(left):
        raw = read(left)
        cur = None
        for m in re.finditer(r'<p class=nospace>\s*(\d+):\s*([^<\n]+)|href="[^"]*g(\d\d)L\.htm">\s*(\d\d):\s*([^<]+)</a>', raw, re.I):
            if m.group(1):
                cur = m.group(1)
                sysname[cur] = m.group(2).strip()
            else:
                grpname[(cur, m.group(3))] = m.group(5).strip()
    tree = collections.OrderedDict()
    other = []
    for page in sorted(pages):
        info = pages[page]
        mt = info["meta"]
        if not mt.get("section"):
            other.append({"t": info["title"] or page, "p": page})
            continue
        sy, gr = mt.get("system", ""), mt.get("group", "")
        sec = f"{sy}{gr}-{mt['section']}"
        st = mt.get("sstype", "")
        k1 = (sy,)
        k2 = (sy, gr)
        tree.setdefault(k1, collections.OrderedDict()).setdefault(k2, collections.OrderedDict()) \
            .setdefault(sec, {"title": mt.get("section_title", ""), "ss": collections.OrderedDict()})["ss"] \
            .setdefault(st, {"title": mt.get("ss_title", st), "pages": []})["pages"].append(
                {"t": mt.get("proctitle") or info["title"] or page, "p": page})
    out = []
    for (sy,), groups in sorted(tree.items(), key=lambda kv: kv[0][0].zfill(2)):
        gnodes = []
        for (s2, gr), secs in sorted(groups.items(), key=lambda kv: kv[0][1]):
            snodes = []
            for sec, sv in sorted(secs.items()):
                ssn = []
                for st, stv in sorted(sv["ss"].items(),
                                      key=lambda kv: SSTYPE_ORDER.index(kv[0]) if kv[0] in SSTYPE_ORDER else 99):
                    ssn.append({"t": stv["title"].title() if stv["title"].isupper() else stv["title"], "c": stv["pages"]})
                snodes.append({"t": f"{sec} {sv['title']}".strip(), "sec": sec, "c": ssn})
            gname = grpname.get((sy, gr), "")
            gnodes.append({"t": f"{gr}: {gname}" if gname else f"Group {gr}", "c": snodes})
        sname = sysname.get(sy, "")
        out.append({"t": f"{sy}: {sname}" if sname else f"System {sy}", "c": gnodes})
    if other:
        out.append({"t": "Other pages", "c": other})
    return out


def toc_pced(book, pages):
    d = os.path.join(SRC, book)
    out, seen = [], set()
    left = os.path.join(d, book.lower() + "left.htm")
    sec_titles = []
    if os.path.exists(left):
        txt = re.sub(r"<[^>]+>", "\n", read(left))
        sec_titles = [unescape(x).strip() for x in re.findall(r"(Introduction|SECTION \d+:[^\n]*)", txt)]
    navs = []
    for p in glob.glob(os.path.join(d, book.lower() + "s*l.htm")):
        m = re.search(r"s(\d+)([a-z]?)l\.htm$", p)
        if m:
            navs.append((int(m.group(1)), m.group(2), p))
    for n, sub, nav in sorted(navs):
        title = next((t for t in sec_titles if t.startswith(f"SECTION {n}:")), None) or (
            "Introduction" if n == 0 else f"Section {n}")
        if sub:
            title += f" ({sub.upper()})"
        items, pending_intro = [], None
        for label, href in links_in(read(nav)):
            stem = os.path.splitext(href.rsplit("/", 1)[-1].lower())[0]
            if stem not in pages or stem in seen:
                continue
            seen.add(stem)
            if label.lower() == "intro":
                pending_intro = stem
                continue
            node = {"t": label or pages[stem]["title"], "p": stem}
            if pending_intro:
                items.append({"t": f"{label} — Intro", "p": pending_intro})
                pending_intro = None
            items.append(node)
        if pending_intro:
            items.append({"t": "Intro", "p": pending_intro})
        out.append({"t": title, "c": items})
    rest = [{"t": pages[p]["title"] or p, "p": p} for p in sorted(pages) if p not in seen]
    if rest:
        out.append({"t": "Other pages", "c": rest})
    return out


def toc_evtm(book, pages):
    mdb = os.path.join(SRC, book, book.lower() + ".mdb")
    out, seen = [], set()
    try:
        raw = subprocess.run(["mdb-export", mdb, "CELLS"], capture_output=True, text=True, errors="replace").stdout
        rows = list(csv.DictReader(io.StringIO(raw)))
    except Exception:  # noqa: BLE001
        rows = []
    groups = collections.OrderedDict()
    for r in sorted(rows, key=lambda r: (r.get("CELL") or "999", r.get("PAGE") or "")):
        fn = (r.get("FILENAME") or "").strip()
        if not fn:
            continue
        stem = os.path.splitext(fn.lower())[0]
        if stem not in pages or stem in seen:
            continue
        seen.add(stem)
        ct = EVTM_CELLTYPE.get(r.get("CELLTYPE", ""), r.get("CELLTYPE", "") or "Other")
        cell = (r.get("CELL") or "").strip()
        ttl = " ".join(x for x in [(r.get("TITLE") or "").strip(), (r.get("SUBTITLE") or "").strip()] if x)
        cnode = groups.setdefault(ct, collections.OrderedDict()).setdefault((cell, ttl), [])
        cnode.append({"t": f"Page {int(r['PAGE']) if (r.get('PAGE') or '').isdigit() else r.get('PAGE')}", "p": stem})
    for ct, cells in groups.items():
        cn = []
        for (cell, ttl), pg in cells.items():
            pg.sort(key=lambda x: x["t"])
            label = f"{cell} {ttl}".strip()
            cn.append({"t": label, "c": pg} if len(pg) > 1 else {"t": label, "p": pg[0]["p"]})
        out.append({"t": ct, "c": cn})
    rest = [{"t": pages[p]["title"] or p, "p": p} for p in sorted(pages) if p not in seen]
    if rest:
        out.append({"t": "Other pages", "c": rest})
    return out


def toc_flat(book, pages):
    return [{"t": pages[p]["title"] or p, "p": p} for p in sorted(pages)]


# ---------------------------------------------------------------- per-book worker
def build_book(job):
    book, info = job
    d = os.path.join(SRC, book)
    files = sorted(os.listdir(d))
    pages = {}
    order = []
    htm_text = set()
    for f in files:
        stem, ext = os.path.splitext(f)
        if ext != ".htm":
            continue
        raw = read(os.path.join(d, f))
        if "Choose an item on the left" in raw or re.search(r"(left|main|right|style)$", stem) or \
                re.match(rf"^{book.lower()}[a-z0-9]$", stem) or re.search(r"g\d\d[lr]$|^.{3,4}s\w{1,4}[lr]$", stem) and not meta_of(raw):
            continue
        if "<frameset" in raw.lower():
            continue
        html, anchors = sanitize(raw, book)
        text_len = len(re.sub(r"<[^>]+>|&nbsp;|\s", "", html))
        if text_len < 30:
            continue
        mt = meta_of(raw)
        title = mt.get("proctitle") or title_of(raw)
        if info["type"] in ("TSB", "RECALL") and info.get("title"):
            title = info["title"]
        pages[stem] = {"meta": mt, "title": title, "h": html}
        order.append(stem)
        if text_len >= 400 or not os.path.exists(os.path.join(d, stem + ".pdf")):
            htm_text.add(stem)
    for f in files:
        stem, ext = os.path.splitext(f)
        if ext != ".pdf" or stem in htm_text:
            continue
        media = Ctx.media.get((book, f.lower()))
        if not media:
            continue
        if stem in pages:  # stub htm + pdf: show both
            pages[stem]["pdf"] = media
        else:
            pages[stem] = {"meta": {}, "title": info["title"] if info["type"] in ("TSB", "RECALL") else "", "pdf": media}
            order.append(stem)
    if info["type"] == "SERVICE" or info["type"] == "BODYREP":
        toc = toc_service(book, pages)
    elif info["type"] == "PCED":
        toc = toc_pced(book, pages)
    elif info["type"] == "EVTM":
        toc = toc_evtm(book, pages)
        # page titles from TOC labels
        def walk(nodes, parent=""):
            for n in nodes:
                if "p" in n and not pages[n["p"]]["title"]:
                    pages[n["p"]]["title"] = f"{parent} — {n['t']}" if parent and n["t"].startswith("Page") else n["t"]
                if "c" in n:
                    walk(n["c"], n["t"])
        walk(toc)
    else:
        toc = toc_flat(book, pages)

    # reading order = TOC order
    seq = []

    def walk_seq(nodes):
        for n in nodes:
            if "p" in n:
                seq.append(n["p"])
            if "c" in n:
                walk_seq(n["c"])
    walk_seq(toc)
    seq += [p for p in order if p not in set(seq)]

    bdir = os.path.join(DATA, "b", book)
    os.makedirs(bdir, exist_ok=True)
    bundles, cur, size = [], {}, 0
    page_map = {}
    for p in seq:
        pg = pages[p]
        entry = {"t": pg["title"]}
        if "h" in pg:
            entry["h"] = pg["h"]
        if "pdf" in pg:
            entry["pdf"] = pg["pdf"]
        if pg["meta"].get("section"):
            entry["s"] = f"{pg['meta'].get('system', '')}{pg['meta'].get('group', '')}-{pg['meta']['section']} {pg['meta'].get('section_title', '')}".strip()
            entry["ss"] = pg["meta"].get("ss_title", "")
        cur[p] = entry
        page_map[p] = len(bundles)
        size += len(entry.get("h", "")) + 200
        if size > BUNDLE_BYTES:
            bundles.append(cur)
            cur, size = {}, 0
    if cur:
        bundles.append(cur)
    for i, b in enumerate(bundles):
        with gzip.open(os.path.join(bdir, f"p{i}.json.gz"), "wt", encoding="utf-8", compresslevel=9) as fh:
            json.dump(b, fh, ensure_ascii=False, separators=(",", ":"))
    book_json = {"code": book, "type": info["type"], "title": info["title"], "vehicles": info["vehicles"],
                 "hr": info.get("hr", ""), "date": info.get("date", ""), "toc": toc, "seq": seq,
                 "pages": page_map}
    with open(os.path.join(bdir, "book.json"), "w", encoding="utf-8") as fh:
        json.dump(book_json, fh, ensure_ascii=False, separators=(",", ":"))

    # search docs from the agent index (same ids as the agent's citations)
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    docs = []
    for cid, file, anchor, title, heading, section, text in con.execute(
            "SELECT id, file, anchor, title, heading, section, text FROM chunks WHERE book=? ORDER BY rowid", (book,)):
        stem = os.path.splitext(file)[0]
        if stem not in pages:
            continue
        docs.append([cid, title or "", heading or "", section or "", re.sub(r"[ \t]+", " ", text)])
    con.close()
    with gzip.open(os.path.join(bdir, "s.json.gz"), "wt", encoding="utf-8", compresslevel=9) as fh:
        json.dump(docs, fh, ensure_ascii=False, separators=(",", ":"))
    return book, len(pages), len(docs), {p: pages[p]["meta"].get("section", "") and
                                          f"{pages[p]['meta'].get('system', '')}{pages[p]['meta'].get('group', '')}-{pages[p]['meta']['section']}"
                                          for p in seq[:0]}


# ---------------------------------------------------------------- media
def hash_file(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()[:20]


def hash_job(item):
    book, fname, typ = item
    return book, fname, typ, hash_file(os.path.join(SRC, book, fname))


def main():
    only = set(sys.argv[1:])
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    infos = {}
    for book in sorted(os.listdir(SRC)):
        info = xml_info(book)
        if included(info) and (not only or book in only):
            infos[book] = info
    print("books:", len(infos), collections.Counter(i["type"] for i in infos.values()))

    # global page → book map (all decoded books, so cross-links resolve)
    for book in os.listdir(SRC):
        for f in os.listdir(os.path.join(SRC, book)):
            stem, ext = os.path.splitext(f)
            if ext in (".htm", ".pdf"):
                Ctx.page_book.setdefault(stem.lower(), book)
    for stem in list(Ctx.page_book):
        if Ctx.page_book[stem] not in infos:
            del Ctx.page_book[stem]

    # media: hash + hardlink into packs (dedup across books)
    items = []
    for book, info in infos.items():
        fs = set(os.listdir(os.path.join(SRC, book)))
        for f in fs:
            if not f.lower().endswith((".gif", ".jpg", ".pdf", ".svgz")):
                continue
            # workshop/body manuals ship a "printable view" PDF next to every htm page: skip those
            if info["type"] in ("SERVICE", "BODYREP") and f.endswith(".pdf") and f[:-4] + ".htm" in fs:
                continue
            items.append((book, f.lower(), info["type"]))
    pack_bytes = collections.Counter()
    placed = {}
    with Pool() as pool:
        for book, fname, typ, h in pool.imap_unordered(hash_job, items, chunksize=256):
            ext = fname.rsplit(".", 1)[1]
            pack = PACK_OF.get(typ, "main")
            if ext == "svgz":
                ext = "svg.gz"
            rel = f"{h[:2]}/{h}.{ext}"
            if (pack, rel) not in placed:
                dst = os.path.join(PACKS, pack, "m", rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                src = os.path.join(SRC, book, fname)
                try:
                    os.link(src, dst)
                except FileExistsError:
                    pass
                placed[(pack, rel)] = True
                pack_bytes[pack] += os.path.getsize(src)
            Ctx.media[(book, fname)] = f"@{pack}/{rel}"
    print("media packs (MB):", {k: round(v / 1e6) for k, v in pack_bytes.items()})

    # navigation pages (section menus) → first content page of that section
    sec_first = {}
    for book, info in infos.items():
        if info["type"] not in ("SERVICE", "BODYREP"):
            continue
        d = os.path.join(SRC, book)
        for f in sorted(os.listdir(d)):
            if not f.endswith(".htm"):
                continue
            stem = f[:-4]
            head = read(os.path.join(d, f))[:2500]
            mt = meta_of(head)
            if mt.get("section"):
                sec_first.setdefault((book, f"{mt.get('system', '')}{mt.get('group', '')}-{mt['section']}"), stem)
        for f in os.listdir(d):
            stem = f[:-4]
            if f.endswith(".htm") and re.search(r"s\w{1,4}[lr]$", stem):
                raw = read(os.path.join(d, f))
                m = re.search(r"SECTION\s+(\d{3})-(\d{2}[A-Z]?)", raw)
                if m and (book, f"{m.group(1)}-{m.group(2)}") in sec_first:
                    Ctx.nav_target[stem] = (book, sec_first[(book, f"{m.group(1)}-{m.group(2)}")])

    results = {}
    with Pool() as pool:
        for i, (book, npages, ndocs, _) in enumerate(pool.imap_unordered(build_book, list(infos.items()), chunksize=2)):
            results[book] = (npages, ndocs)
            if i % 100 == 0:
                print(f"{i}/{len(infos)} {book} pages={npages} docs={ndocs}", flush=True)

    # catalog
    models = collections.OrderedDict()
    canon = {}
    for book, info in infos.items():
        if info["type"] == "SERVICE":
            for v in info["vehicles"]:
                if v["m"]:
                    canon.setdefault(key(v["m"]), v["m"])

    def canon_of(name):
        k = key(name)
        if k in canon:
            return canon[k]
        toks = set(re.findall(r"[a-z0-9]+", name.lower().replace("f150", "f 150")))
        for ck, cn in canon.items():
            ct = set(re.findall(r"[a-z0-9]+", cn.lower()))
            if toks and (toks <= ct or ct <= toks) and len(toks & ct) >= 1 and \
                    (len(ct) > 1 or len(toks) == 1):
                return cn
        return None

    docs_meta = {}
    for book, info in sorted(infos.items()):
        typ = info["type"]
        if typ in ("TSB", "RECALL", "CALIB"):
            docs_meta[book] = {"type": typ, "n": info.get("hr", ""), "t": info["title"], "d": info.get("date", ""),
                               "v": sorted({f"{v['y']} {v['m']}" for v in info["vehicles"]})[:60]}
        for v in info["vehicles"]:
            if v["y"] < MIN_YEAR or typ == "CALIB":
                continue
            cn = canon_of(v["m"])
            if not cn:
                continue
            yr = models.setdefault(cn, {}).setdefault(str(v["y"]), collections.defaultdict(list))
            if book not in yr[typ]:
                yr[typ].append(book)
    catalog = {
        "models": [{"name": m, "years": {y: dict(t) for y, t in sorted(ys.items())}} for m, ys in
                   sorted(models.items(), key=lambda kv: kv[0].lower())],
        "books": {b: {"type": i["type"], "title": i["title"],
                      "veh": sorted({f"{v['y']} {v['m']}" for v in i["vehicles"]})[:8]}
                  for b, i in infos.items() if i["type"] in ("SERVICE", "PCED", "EVTM", "BODYREP")},
        "docs": docs_meta,
        "calib": sorted(b for b, i in infos.items() if i["type"] == "CALIB"),
    }
    with open(os.path.join(OUT, "public", "config.json"), "w", encoding="utf-8") as fh:
        json.dump({"packs": {p: f"packs/{p}/m/" for p in ("main", "fig", "wd")}}, fh)
    with open(os.path.join(DATA, "catalog.json"), "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, ensure_ascii=False, separators=(",", ":"))
    tot = sum(os.path.getsize(p) for p in glob.glob(os.path.join(DATA, "**", "*"), recursive=True) if os.path.isfile(p))
    print(f"done: {len(results)} books, {sum(r[0] for r in results.values())} pages, data {tot / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
