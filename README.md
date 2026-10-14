# Ford Repair Agent

AI repair assistant for Ford / Lincoln / Mercury **2000–2004** vehicles. Runs in [Claude Code](https://claude.com/claude-code).
You give it a vehicle and a question. It answers **only from the Ford service manual** (Workshop Manual, PCED/DTC
diagnosis, wiring diagrams, body repair, TSBs, recalls), cites every statement with a source ID, and checks
itself before it answers: quotes are verified against the source text, and an independent verifier subagent
re-reads every cited source.

Web viewer for the same manual (navigation, search, figures, wiring PDFs): https://labtorie.github.io/ford-manual/

There is also a lighter in-browser chat on the web viewer (car page → **🤖 ИИ-чат**). It uses the visitor's own free
[OpenRouter](https://openrouter.ai/keys) key. The key stays in the browser and is sent only to OpenRouter. It needs
2–4 model requests per question, so it fits the free tier (50 requests/day): plan → in-browser search → answer with
citations → deterministic quote check → verifier → revision if needed. Code: `web/app/src/chat/`.

## Setup (macOS, Linux, Windows)

Requirements: Claude Code, Python 3.9+, git (on Windows: Git for Windows, since Claude Code uses Git Bash).

```bash
git clone https://github.com/labtorie/ford-repair-agent.git
cd ford-repair-agent
python3 tools/fetch_index.py      # downloads the search index (~165 MB → index/manual.db, ~660 MB)
claude
```

On Windows use `py tools\fetch_index.py` (or `python`). No other dependencies are needed.

## Usage

```
/ford 2003 F-150 5.4L check engine light, code P0171. What should I check?
/ford 2002 Explorer 4.0L front brake caliper bolt torque
```

Always give the **year and model**, plus the engine and drive type if you can. You can ask in Russian or in English.
Answers cite sources like `[S31/s31j2002#A]`. Paste an ID into **"Перейти к ID"** (go to ID) on the web viewer
to open that exact page, test, or step with its figures.

ID prefixes: `S` Workshop Manual (e.g. `S31` = 2003 F-150), `V` PCED, `E` wiring, `B` body repair, `T` TSB, `R` recall,
`C` calibration. The part after `#` is an anchor: a pinpoint test (`#A`) or a step (`#pptH41`).

## Command-line tools

`tools/manual.sh` (or `python3 tools/manual.py`):

| command | |
|---|---|
| `vehicles [filter]` | covered models/years and their books |
| `search "<terms>" --model M --year Y [--type SERVICE,PCED,EVTM,TSB,…]` | full-text search (English terms) |
| `read <ID> [--page]` | full text of a chunk, page and web link |
| `links <ID>` | where the "GO to / REFER to" links of a chunk lead |
| `verify-quote <ID> "<quote>"` | check that a quote appears verbatim in the source |

## Repository layout

- `.claude/skills/ford/` — the `/ford` workflow; `.claude/agents/manual-verifier.md` — the verifier subagent.
- `tools/manual.py`, `tools/manual.sh`, `tools/fetch_index.py` — what the agent needs at runtime.
- `tools/podbay.py`, `tools/extract_all.py`, `tools/htmltext.py`, `tools/build_index.py` — rebuilding the index from the
  original TSO DVD (`2000_2004 Ford Car Service Manual.iso`). Its content is stored in a proprietary "POD BAY"
  `.ARC` / IDICOMP format; `podbay.py` decodes it. Only maintainers need these.
- `web/` — the web viewer (React + Vite), its data builder and `deploy.sh` for GitHub Pages.

### Rebuilding the index from the ISO (maintainers)

```bash
mkdir -p raw && tar -xf "2000_2004 Ford Car Service Manual.iso" -C raw CONTENT/USENI4
python3 -m venv .venv && .venv/bin/pip install pypdf
.venv/bin/python tools/extract_all.py      # → out/USENI4
.venv/bin/python tools/build_index.py      # → index/manual.db
```

The manual content is © Ford Motor Company.
