#!/usr/bin/env python3
"""Download the prebuilt search index (index/manual.db) from the GitHub release.

  python3 tools/fetch_index.py            # latest release
  python3 tools/fetch_index.py --url URL  # custom location of manual.db.gz

Standard library only. The .gz is verified against its published SHA-256 before use.
"""
import argparse
import gzip
import hashlib
import os
import shutil
import sqlite3
import sys
import tempfile
import urllib.request

REPO = "labtorie/ford-repair-agent"
DEFAULT_URL = f"https://github.com/{REPO}/releases/latest/download/manual.db.gz"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DB = os.path.join(ROOT, "index", "manual.db")


def download(url, dst):
    with urllib.request.urlopen(url) as r:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        h = hashlib.sha256()
        with open(dst, "wb") as f:
            while True:
                buf = r.read(1 << 20)
                if not buf:
                    break
                f.write(buf)
                h.update(buf)
                done += len(buf)
                if total:
                    print(f"\r  {done / 1e6:6.0f} / {total / 1e6:.0f} MB", end="", flush=True)
    print()
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=DEFAULT_URL)
    a = ap.parse_args()
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="ford-index-")
    gz = os.path.join(tmp, "manual.db.gz")
    try:
        print(f"Downloading {a.url}")
        try:
            digest = download(a.url, gz)
            expected = urllib.request.urlopen(a.url + ".sha256").read().decode().split()[0]
        except Exception as e:  # noqa: BLE001
            sys.exit(f"Download failed: {e}\n"
                     f"If this is an SSL certificate error on macOS, run 'Install Certificates.command' from your "
                     f"Python folder, or download the file manually:\n  curl -L -o manual.db.gz {a.url}\n"
                     f"and run:  python3 tools/fetch_index.py --url file://$PWD/manual.db.gz")
        if digest != expected:
            sys.exit(f"Checksum mismatch: got {digest}, expected {expected}")
        print("Checksum OK, unpacking…")
        part = DB + ".part"
        with gzip.open(gz, "rb") as src, open(part, "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        n = sqlite3.connect(part).execute("SELECT count(*) FROM chunks").fetchone()[0]
        os.replace(part, DB)
        print(f"Index ready: {os.path.relpath(DB)} ({n} chunks)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
