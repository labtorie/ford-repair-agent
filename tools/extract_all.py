"""Decode all POD BAY .ARC archives into out/<LANG>/<ARCNAME>/<file>."""
import collections
import glob
import os
import sys
from multiprocessing import Pool

import podbay

SRC = sys.argv[1] if len(sys.argv) > 1 else "raw/CONTENT/USENI4"
DST = sys.argv[2] if len(sys.argv) > 2 else "out/USENI4"


def work(path):
    arc = os.path.splitext(os.path.basename(path))[0]
    d = os.path.join(DST, arc)
    os.makedirs(d, exist_ok=True)
    stats = collections.Counter()
    try:
        for rid, typ, data in podbay.records(path):
            ext = podbay.TYPES.get(typ, f"t{typ:04x}")
            name = podbay.name_of(rid) or rid.hex()
            fn = os.path.join(d, f"{name}.{ext}")
            if os.path.exists(fn):  # e.g. the per-archive .xml/.wcf share the id
                fn = os.path.join(d, f"{name}_{rid.hex()}.{ext}")
            with open(fn, "wb") as f:
                f.write(data)
            stats[ext] += 1
    except Exception as e:  # noqa: BLE001
        stats[f"ERROR {type(e).__name__}: {e}"] += 1
    return arc, stats


if __name__ == "__main__":
    files = sorted(glob.glob(os.path.join(SRC, "*.ARC")))
    total = collections.Counter()
    errors = []
    with Pool() as pool:
        for i, (arc, st) in enumerate(pool.imap_unordered(work, files, chunksize=4)):
            total.update(st)
            errors += [(arc, k) for k in st if k.startswith("ERROR")]
            if i % 500 == 0:
                print(i, "/", len(files), flush=True)
    print(dict(total))
    for e in errors[:50]:
        print(*e)
