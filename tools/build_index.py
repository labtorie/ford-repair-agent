"""Build SQLite FTS5 index (index/manual.db) over the decoded manual in out/USENI4.

Chunk id = "<BOOK>/<page>[#anchor][.n]", e.g. "S31/s31j2002#A" (Pinpoint Test A).
"""
import glob
import logging
import os
import re
import sqlite3
import sys
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(__file__))
import htmltext  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "out", "USENI4")
DB = os.path.join(ROOT, "index", "manual.db")
MAX_CHUNK = 7000

logging.getLogger("pypdf").setLevel(logging.ERROR)

# Archive type -> human label
DOC_TYPES = {
    "SERVICE": "Workshop Manual", "EVTM": "Wiring Diagrams (EVTM)", "PCED": "Powertrain Control/Emissions Diagnosis (PCED)",
    "BODYREP": "Body Repair Manual", "TSB": "Technical Service Bulletin", "RECALL": "Recall", "CALIB": "Calibration",
}
NAV_PAGE = re.compile(r"^[a-z0-9]{3,4}(left|main|style|[a-z0-9]|[a-z]?g\d\d[lr]|s\w{2,4}[lr])$")


def read_xml(path):
    s = open(path, encoding="cp1252", errors="replace").read()
    g = lambda t: (re.search(rf"<{t}>(.*?)</{t}>", s, re.S) or [None, ""])[1].strip()  # noqa: E731
    veh = re.findall(r"<vehicle>\s*<year>(\d+)</year>\s*<name>([^<]*)</name>", s)
    return {"type": g("type"), "title": g("title"), "hr_name": g("hr_name"),
            "prod_date": g("prod_date"), "vehicles": sorted(set(veh))}


def split_long(text, limit=MAX_CHUNK):
    if len(text) <= limit:
        return [text]
    parts, cur = [], ""
    for para in re.split(r"(\n\n)", text):
        if len(cur) + len(para) > limit and cur.strip():
            parts.append(cur)
            cur = ""
        cur += para
    if cur.strip():
        parts.append(cur)
    out = []
    for p in parts:  # hard split for giant paragraphs/tables
        out += [p[i:i + limit] for i in range(0, len(p), limit)]
    return out


def pdf_text(path):
    from pypdf import PdfReader
    try:
        r = PdfReader(path)
        return "\n\n".join((p.extract_text() or "") for p in r.pages).strip()
    except Exception as e:  # noqa: BLE001
        return f"[PDF text extraction failed: {e}]"


def process_book(book):
    d = os.path.join(SRC, book)
    xmlp = os.path.join(d, book.lower() + ".xml")
    info = read_xml(xmlp) if os.path.exists(xmlp) else {"type": "", "title": "", "vehicles": []}
    rows = []
    pages_with_text = set()
    for path in sorted(glob.glob(os.path.join(d, "*.htm")) + glob.glob(os.path.join(d, "*.pdf"))):
        page, ext = os.path.splitext(os.path.basename(path))
        if ext == ".htm" and NAV_PAGE.match(page):
            continue
        if ext == ".pdf":
            # body-repair pages ship a "printable" PDF duplicate of the htm
            # "printable view" PDFs duplicate an htm page that already produced text
            if page in pages_with_text:
                continue
            meta, secs = {}, [{"anchor": "", "heading": "", "text": pdf_text(path)}]
        else:
            raw = open(path, encoding="cp1252", errors="replace").read()
            meta, secs = htmltext.parse(raw)
            if not meta.get("sstype") and "Choose an item on the left" in raw:
                continue
            # TSB/recall wrapper pages that only point to the PDF
            if os.path.exists(os.path.join(d, page + ".pdf")) and sum(len(x["text"]) for x in secs) < 400:
                continue
        title = meta.get("proctitle") or ""
        if not title:
            m = re.search(r"<title>(.*?)</title>", raw if ext == ".htm" else "", re.S | re.I)
            title = re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
        if not title and ext == ".pdf":
            title = next((ln.strip() for ln in secs[0]["text"].splitlines() if ln.strip()), "")[:120]
        if info["type"] in ("TSB", "RECALL") and info.get("title"):
            title = f"{info['type']} {info.get('hr_name') or book}: {info['title']}"
        section = " ".join(x for x in [meta.get("section") and f"{meta.get('system', '')}{meta.get('group', '')}-{meta.get('section')}",
                                       meta.get("section_title", "")] if x)
        # drop the tiny page-banner block when real sections follow
        if len(secs) > 1 and not secs[0]["heading"] and len(secs[0]["text"]) < 300:
            banner = secs.pop(0)["text"]
            if not section:
                section = banner.split("\n")[0][:120]
        n_total = 0
        for s in secs:
            text = s["text"].strip()
            if len(text) < 40:
                continue
            for k, part in enumerate(split_long(text)):
                cid = f"{book}/{page}" + (f"#{s['anchor']}" if s["anchor"] else "")
                if k:
                    cid += f".{k + 1}"
                # make ids unique within page
                base, j = cid, 2
                while any(r[0] == cid for r in rows[-200:]):
                    cid = f"{base}~{j}"
                    j += 1
                rows.append((cid, book, page + ext, s["anchor"], info["type"], meta.get("year", ""),
                             meta.get("modelname", ""), section, meta.get("ss_title", ""), title,
                             s["heading"], part))
                n_total += 1
                pages_with_text.add(page)
    return book, info, rows


def main():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    if os.path.exists(DB):
        os.remove(DB)
    con = sqlite3.connect(DB)
    con.executescript("""
    CREATE TABLE books(book TEXT PRIMARY KEY, type TEXT, title TEXT, hr_name TEXT, prod_date TEXT);
    CREATE TABLE book_vehicles(book TEXT, year INTEGER, model TEXT, model_key TEXT);
    CREATE TABLE nav(page TEXT PRIMARY KEY, book TEXT, section TEXT);
    CREATE TABLE chunks(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, book TEXT, file TEXT, anchor TEXT,
        doc_type TEXT, year TEXT, model TEXT, section TEXT, subsection TEXT, title TEXT, heading TEXT, text TEXT);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(title, heading, section, text,
        content='chunks', content_rowid='rowid', tokenize='porter unicode61');
    """)
    books = sorted(os.listdir(SRC))
    n = 0
    with Pool() as pool:
        for i, (book, info, rows) in enumerate(pool.imap_unordered(process_book, books, chunksize=8)):
            con.execute("INSERT INTO books VALUES(?,?,?,?,?)",
                        (book, info["type"], info["title"], info.get("hr_name", ""), info.get("prod_date", "")))
            con.executemany("INSERT INTO book_vehicles VALUES(?,?,?,?)",
                            [(book, int(y), m, re.sub(r"[^a-z0-9]", "", m.lower())) for y, m in info["vehicles"]])
            con.executemany("INSERT OR IGNORE INTO chunks(id,book,file,anchor,doc_type,year,model,section,subsection,title,heading,text)"
                            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            n += len(rows)
            if i % 500 == 0:
                print(f"{i}/{len(books)} books, {n} chunks", flush=True)
                con.commit()
    # section menu pages ("REFER to Section 417-02" links) are not indexed as chunks: keep a map
    for book in books:
        d = os.path.join(SRC, book)
        for f in os.listdir(d):
            if f.endswith(".htm") and re.search(r"s\w{1,4}[lr]\.htm$", f):
                m = re.search(r"SECTION\s+(\d{3})-(\d{2}[A-Z]?)", open(os.path.join(d, f), encoding="cp1252", errors="replace").read())
                if m:
                    con.execute("INSERT OR IGNORE INTO nav VALUES(?,?,?)", (f[:-4].lower(), book, f"{m.group(1)}-{m.group(2)}"))
    con.execute("INSERT INTO chunks_fts(rowid,title,heading,section,text) SELECT rowid,title,heading,section,text FROM chunks")
    con.execute("CREATE INDEX bv_book ON book_vehicles(book)")
    con.execute("CREATE INDEX bv_key ON book_vehicles(model_key, year)")
    con.execute("CREATE INDEX ch_book ON chunks(book)")
    con.commit()
    con.execute("VACUUM")
    print("done:", n, "chunks")


if __name__ == "__main__":
    main()
