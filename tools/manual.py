#!/usr/bin/env python3
"""Search / read the indexed Ford 2000-2004 service manual (index/manual.db).

  manual.py vehicles [filter]                     list models/years and their books
  manual.py search "<query>" [--model M] [--year Y] [--type T,..] [-n N] [--any]
  manual.py read <ID> [<ID> ...] [--page]         full text of chunk(s); --page = whole page
  manual.py links <ID>                            in-manual links found in a chunk, resolved to IDs
  manual.py verify-quote <ID> "<quote>"           check that a quote appears verbatim in the source

Types: SERVICE (workshop manual), PCED (powertrain/DTC diagnosis), EVTM (wiring), BODYREP,
       TSB, RECALL, CALIB.
"""
import argparse
import os
import re
import sqlite3
import sys

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "index", "manual.db")
WEB = os.environ.get("FORD_MANUAL_WEB", "https://labtorie.github.io/ford-manual/").rstrip("/") + "/"
TYPE_LABEL = {"SERVICE": "Workshop Manual", "PCED": "PCED (powertrain diagnosis)", "EVTM": "Wiring Diagrams",
              "BODYREP": "Body Repair", "TSB": "TSB", "RECALL": "Recall", "CALIB": "Calibration"}


def db():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def key(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def books_for(con, model, year, types):
    where, args = [], []
    if model:
        exact = con.execute("SELECT 1 FROM book_vehicles WHERE model_key=? LIMIT 1", (key(model),)).fetchone()
        where.append("bv.model_key = ?" if exact else "bv.model_key LIKE ?")
        args.append(key(model) if exact else f"%{key(model)}%")
    if year:
        where.append("bv.year = ?")
        args.append(int(year))
    if types:
        where.append(f"b.type IN ({','.join('?' * len(types))})")
        args += types
    sql = "SELECT DISTINCT b.book FROM books b JOIN book_vehicles bv ON bv.book=b.book"
    if where:
        sql += " WHERE " + " AND ".join(where)
    return [r[0] for r in con.execute(sql, args)]


def header(r):
    parts = [f"[{r['id']}]", TYPE_LABEL.get(r["doc_type"], r["doc_type"])]
    if r["year"] or r["model"]:
        parts.append(f"{r['year']} {r['model']}".strip())
    for k in ("section", "subsection", "title", "heading"):
        if r[k] and r[k] not in parts:
            parts.append(r[k])
    return " | ".join(parts)


def vehicles_of(con, book, model=None, year=None):
    """Applicability list; when model/year given, show the matching entries first."""
    rows = con.execute("SELECT year, model, model_key FROM book_vehicles WHERE book=? ORDER BY year, model",
                       (book,)).fetchall()
    hit = lambda r: (not model or key(model) in r[2]) and (not year or str(r[0]) == str(year))  # noqa: E731
    first = [r for r in rows if (model or year) and hit(r)]
    rest = [r for r in rows if r not in first]
    s = "; ".join(f"{y} {m}" for y, m, _ in first + rest)
    return (f"[matches {len(first)}] " if (model or year) else "") + s


def cmd_vehicles(a):
    con = db()
    rows = con.execute("""SELECT bv.year, bv.model, b.type, group_concat(b.book, ' ') books
        FROM book_vehicles bv JOIN books b ON b.book=bv.book
        WHERE b.type IN ('SERVICE','PCED','EVTM','BODYREP') GROUP BY 1,2,3 ORDER BY 2,1,3""").fetchall()
    f = key(a.filter or "")
    for r in rows:
        if f and f not in key(r["model"]) and f != str(r["year"]):
            continue
        print(f"{r['year']}  {r['model']:<40} {r['type']:<8} {r['books']}")


def fts_query(q, any_term):
    toks = re.findall(r"[A-Za-z0-9][A-Za-z0-9./-]*", q)
    toks = ['"' + t.replace('"', "") + '"' for t in toks]
    return (" OR " if any_term else " ").join(toks)


def cmd_search(a):
    con = db()
    types = [t.strip().upper() for t in a.type.split(",")] if a.type else None
    books = books_for(con, a.model, a.year, types) if (a.model or a.year or types) else None
    if books is not None and not books:
        print("No books match this model/year/type. Run `vehicles` to see exact model names.")
        return
    for any_term in ([True] if a.any else [False, True]):
        q = fts_query(a.query, any_term)
        if not q:
            print("Empty query")
            return
        sql = """SELECT c.*, snippet(chunks_fts, 3, '>>', '<<', ' … ', 24) snip,
                 bm25(chunks_fts, 6.0, 5.0, 3.0, 1.0) score
                 FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
                 WHERE chunks_fts MATCH ?"""
        args = [q]
        if books is not None:
            sql += f" AND c.book IN ({','.join('?' * len(books))})"
            args += books
        sql += " ORDER BY score LIMIT ?"
        args.append(a.n)
        rows = con.execute(sql, args).fetchall()
        if rows or any_term:
            break
    if not rows:
        print("No results.")
        return
    if any_term and not a.any:
        print("(no chunk contains ALL terms — showing results matching ANY term)\n")
    for r in rows:
        print(header(r))
        if r["doc_type"] in ("TSB", "RECALL", "PCED"):
            print("   applies to:", vehicles_of(con, r["book"], a.model, a.year)[:300])
        print("   …", re.sub(r"\s+", " ", r["snip"]))
        print()


def resolve(con, ident):
    """Accept 'BOOK/page#anchor', 'page#anchor', or '→page' link targets."""
    ident = ident.strip().lstrip("→").strip("()[] ")
    r = con.execute("SELECT * FROM chunks WHERE id=?", (ident,)).fetchone()
    if r:
        return [r]
    page, _, anchor = ident.partition("#")
    page = page.split("/")[-1].lower()
    rows = con.execute("SELECT * FROM chunks WHERE file IN (?,?) ORDER BY rowid",
                       (page + ".htm", page + ".pdf")).fetchall()
    if anchor:
        exact = [r for r in rows if r["anchor"] == anchor]
        if exact:
            return exact
        # anchor of a step inside a section (e.g. A2 inside Pinpoint Test A)
        sec = [r for r in rows if r["anchor"] and anchor.startswith(r["anchor"])]
        if sec:
            return sec
    return rows


def web_url(r):
    page = os.path.splitext(r["file"])[0]
    return f"{WEB}#/v/{r['book']}/{page}" + (f"/{r['anchor']}" if r["anchor"] else "")


def show(con, r):
    print("=" * 100)
    print(header(r))
    old = r["doc_type"] in ("TSB", "RECALL", "CALIB") and not con.execute(
        "SELECT 1 FROM book_vehicles WHERE book=? AND year>=2000", (r["book"],)).fetchone()
    print("web (with figures): " + ("not in the web viewer (pre-2000 document)" if old else web_url(r)))
    if r["doc_type"] in ("TSB", "RECALL", "PCED", "SERVICE", "EVTM"):
        print("applies to:", vehicles_of(con, r["book"])[:500])
    print("-" * 100)
    print(r["text"])
    print()


def cmd_read(a):
    con = db()
    for ident in a.ids:
        rows = resolve(con, ident)
        if not rows:
            print(f"Not found: {ident}")
            continue
        if a.page and len(rows) == 1:
            rows = con.execute("SELECT * FROM chunks WHERE book=? AND file=? ORDER BY rowid",
                               (rows[0]["book"], rows[0]["file"])).fetchall()
        for r in rows:
            show(con, r)


def nav_hint(con, target, book):
    """Navigation pages (section menus) are not indexed: point to the section's chunks instead."""
    page = target.split("#")[0].lower()
    n = con.execute("SELECT book, section FROM nav WHERE page=?", (page,)).fetchone()
    if not n:
        return f"{target} (not in manual index)"
    rows = con.execute("SELECT subsection, min(id) id FROM chunks WHERE book=? AND section LIKE ? "
                       "GROUP BY subsection ORDER BY min(rowid)", (n["book"], n["section"] + " %")).fetchall()
    return f"Section {n['section']}: " + "; ".join(f"{r['subsection']} {r['id']}" for r in rows)


def cmd_links(a):
    con = db()
    for r in resolve(con, a.id):
        for label, target in re.findall(r"([^\n(]{0,60})\(→([^)]+)\)", r["text"]):
            t = resolve(con, target)
            dest = t[0]["id"] if t else nav_hint(con, target, r["book"])
            print(f"{label.strip()[-60:]:<60} → {dest}")


def _norm(s):
    s = s.replace("**", "").replace("’", "'").replace("–", "-").replace("—", "-")
    return re.sub(r"[\s|]+", " ", s).strip().lower()


def cmd_verify(a):
    con = db()
    rows = resolve(con, a.id)
    if not rows:
        print(f"NOT FOUND: source {a.id} does not exist")
        sys.exit(2)
    text = _norm("\n".join(r["text"] for r in rows))
    q = _norm(a.quote)
    if q in text:
        print(f"OK: quote found verbatim in {a.id}")
        return
    # report the best partial match to help fix paraphrases
    words = q.split()
    best = 0
    for n in range(len(words), 0, -1):
        if any(" ".join(words[i:i + n]) in text for i in range(len(words) - n + 1)):
            best = n
            break
    print(f"MISMATCH: quote NOT found in {a.id} (longest matching run: {best}/{len(words)} words)")
    sys.exit(1)


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("vehicles"); s.add_argument("filter", nargs="?"); s.set_defaults(f=cmd_vehicles)
    s = sub.add_parser("search"); s.add_argument("query"); s.add_argument("--model"); s.add_argument("--year")
    s.add_argument("--type"); s.add_argument("-n", type=int, default=10); s.add_argument("--any", action="store_true")
    s.set_defaults(f=cmd_search)
    s = sub.add_parser("read"); s.add_argument("ids", nargs="+"); s.add_argument("--page", action="store_true")
    s.set_defaults(f=cmd_read)
    s = sub.add_parser("links"); s.add_argument("id"); s.set_defaults(f=cmd_links)
    s = sub.add_parser("verify-quote"); s.add_argument("id"); s.add_argument("quote"); s.set_defaults(f=cmd_verify)
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
