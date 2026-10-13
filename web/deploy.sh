#!/usr/bin/env bash
# Deploy the manual viewer to GitHub Pages as three sites (each Pages site is limited to 1 GB):
#   <repo>       app + text data + small media      https://<owner>.github.io/<repo>/
#   <repo>-fig   workshop-manual illustrations      https://<owner>.github.io/<repo>-fig/
#   <repo>-wd    wiring diagrams (EVTM)             https://<owner>.github.io/<repo>-wd/
#
# Usage: web/deploy.sh <owner> [repo=ford-manual] [--private] [--agent-repo URL] [--main-only]
#   --main-only  redeploy just the app/text site (media packs unchanged)
# Needs: gh (authenticated), git, node/npm; data built by web/scripts/build_data.py.
set -euo pipefail

OWNER="${1:?usage: deploy.sh <owner> [repo] [--private] [--agent-repo URL]}"; shift
REPO="ford-manual"
if [[ $# -gt 0 && "$1" != --* ]]; then REPO="$1"; shift; fi
VIS="--public"
AGENT_REPO=""
MAIN_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --private) VIS="--private"; shift ;;
    --agent-repo) AGENT_REPO="$2"; shift 2 ;;
    --main-only) MAIN_ONLY=1; shift ;;
    *) echo "unknown arg $1"; exit 1 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/build"
OUT="$BUILD/deploy"
BASE="https://${OWNER}.github.io"

echo "==> building app"
(cd "$HERE/app" && npm ci --silent && npm run build)

echo "==> assembling sites in $OUT"
rm -rf "$OUT"; mkdir -p "$OUT/main" "$OUT/fig" "$OUT/wd"
cp -R "$BUILD/site/." "$OUT/main/"
cp -R "$BUILD/public/data" "$OUT/main/data"
mkdir -p "$OUT/main/packs/main"
cp -R "$BUILD/packs/main/m" "$OUT/main/packs/main/m"
if [[ $MAIN_ONLY == 0 ]]; then
  cp -R "$BUILD/packs/fig/m" "$OUT/fig/m"
  cp -R "$BUILD/packs/wd/m" "$OUT/wd/m"
fi
python3 - "$OUT/main/config.json" "$BASE/$REPO-fig/m/" "$BASE/$REPO-wd/m/" "$AGENT_REPO" <<'PY'
import json, sys
cfg = {"packs": {"main": "packs/main/m/", "fig": sys.argv[2], "wd": sys.argv[3]}}
if sys.argv[4]:
    cfg["agentRepo"] = sys.argv[4]
json.dump(cfg, open(sys.argv[1], "w"))
PY
for d in main fig wd; do
  touch "$OUT/$d/.nojekyll"
  echo "  $d: $(du -sh "$OUT/$d" | cut -f1)"
done

publish() {  # <dir> <repo>
  local dir="$1" name="$2"
  echo "==> publishing $name"
  gh repo view "$OWNER/$name" >/dev/null 2>&1 || gh repo create "$OWNER/$name" $VIS --description "Ford 2000-2004 service manual viewer ($name)"
  (
    cd "$dir"
    rm -rf .git
    git init -q -b main
    git add -A
    git -c user.name="deploy" -c user.email="deploy@localhost" commit -qm "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
    git remote add origin "https://github.com/$OWNER/$name.git"
    git push -f -q origin main
  )
  gh api -X POST "repos/$OWNER/$name/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
    || gh api -X PUT "repos/$OWNER/$name/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true
}

if [[ $MAIN_ONLY == 0 ]]; then
  publish "$OUT/fig" "$REPO-fig"
  publish "$OUT/wd" "$REPO-wd"
fi
publish "$OUT/main" "$REPO"

echo
echo "Done. Pages may take a few minutes to build:"
echo "  $BASE/$REPO/"
