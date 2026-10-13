# FordRepairAgent

Repair assistant over the Ford 2000–2004 service manual (TSO DVD, `2000_2004 Ford Car Service Manual.iso`).
Runtime needs only `index/manual.db` — get it with `python3 tools/fetch_index.py` (GitHub release); the ISO is only for rebuilding it.

## Rules for repair questions
- Answer repair / diagnosis / spec questions **only from the manual**, via the `/ford` skill workflow
  (`.claude/skills/ford/SKILL.md`): search → read sources → draft with `[ID]` citations → `verify-quote` + `manual-verifier` subagent → final answer.
- Never fill gaps with general automotive knowledge; say what was not found in the manual.

## Layout
- `tools/podbay.py` — decoder for the proprietary "POD BAY" .ARC / IDICOMP format; `tools/extract_all.py` — bulk decode.
- `out/USENI4/<BOOK>/` — decoded US-English content (htm, gif, pdf). Book prefixes: S=workshop manual, V=PCED,
  E=wiring (EVTM, PDF), B=body repair, T*=TSB, R*=recall, C*=calibration. `<book>.xml` holds book metadata/vehicles.
- `tools/htmltext.py` + `tools/build_index.py` — build `index/manual.db` (SQLite FTS5). Rebuild: `.venv/bin/python tools/build_index.py`.
- `tools/manual.py` — CLI: `vehicles`, `search`, `read`, `links`, `verify-quote` (stdlib only). Call it via `tools/manual.sh`,
  which picks the venv Python on macOS/Linux (`.venv/bin`) or Windows (`.venv/Scripts`).
- `tools/fetch_index.py` — download the prebuilt index from the latest release (`manual.db.gz` + `.sha256`).
- `raw/`, `out/` — only when rebuilding from the ISO (gitignored). `web/` — web viewer + GitHub Pages deploy.
- Python deps live in `.venv` (pypdf).
