#!/usr/bin/env bash
# Cross-platform launcher for tools/manual.py (macOS/Linux venv, Windows venv via Git Bash, or system Python).
# manual.py itself needs only the standard library.
cd "$(dirname "$0")/.." || exit 1
for py in .venv/bin/python .venv/Scripts/python.exe python3 python py; do
  if command -v "$py" >/dev/null 2>&1 || [ -x "$py" ]; then
    PYTHONIOENCODING=utf-8 PYTHONUTF8=1 exec "$py" tools/manual.py "$@"
  fi
done
echo "Python not found: create .venv (see CLAUDE.md)" >&2
exit 1
