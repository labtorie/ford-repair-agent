"""Reader for Ford TSO "POD BAY" .ARC archives (IDICOMP compression).

Format (reverse-engineered from tsobrowser.exe):
  archive: b"POD BAY" + u16 version(=1) + u32 count + count * 15-byte index entries
  entry:   6 bytes id | u16 type | u32 offset | u24 size
  record:  b"\\x01IDICOMP\\x01" + blocks: i16 len (<0: raw -len bytes, 0: end) + data
  block:   LZ77, u16 LE flag word read MSB-first; 0 = literal byte, 1 = command:
           hi=b>>4, lo=b&15
           hi==0: RLE  count=lo+3,                 byte=next
           hi==1: RLE  count=lo+(next<<4)+0x13,    byte=next
           hi==2: copy off=lo+3+(next<<4), count=next+0x10
           else:  copy off=lo+3+(next<<4), count=hi
"""
import struct

MAGIC = b"\x01IDICOMP\x01"


def lz_block(src: bytes, out: bytearray) -> None:
    i, n, mask, flags = 0, len(src), 0, 0
    while i < n:
        mask >>= 1
        if mask == 0:
            flags = src[i] | (src[i + 1] << 8)
            i += 2
            mask = 0x8000
            if i >= n:
                break
        if not flags & mask:
            out.append(src[i])
            i += 1
            continue
        b = src[i]
        i += 1
        hi, lo = b >> 4, b & 15
        if hi == 0:
            out += bytes([src[i]]) * (lo + 3)
            i += 1
        elif hi == 1:
            cnt = lo + (src[i] << 4) + 0x13
            out += bytes([src[i + 1]]) * cnt
            i += 2
        else:
            off = lo + 3 + (src[i] << 4)
            i += 1
            if hi == 2:
                cnt = src[i] + 0x10
                i += 1
            else:
                cnt = hi
            s = len(out) - off
            for k in range(cnt):  # may overlap
                out.append(out[s + k])


def decompress(rec: bytes) -> bytes:
    if not rec.startswith(MAGIC):
        return rec
    out = bytearray()
    p = len(MAGIC)
    while p + 2 <= len(rec):
        (ln,) = struct.unpack_from("<h", rec, p)
        p += 2
        if ln == 0:
            break
        if ln < 0:
            out += rec[p:p - ln]
            p -= ln
        else:
            lz_block(rec[p:p + ln], out)
            p += ln
    return bytes(out)


def entries(data: bytes):
    if data[:7] != b"POD BAY":
        raise ValueError("not a POD BAY archive")
    (count,) = struct.unpack_from("<I", data, 9)
    for k in range(count):
        e = data[13 + 15 * k: 28 + 15 * k]
        rid, typ = e[:6], struct.unpack_from("<H", e, 6)[0]
        off = struct.unpack_from("<I", e, 8)[0]
        size = int.from_bytes(e[12:15], "little")
        yield rid, typ, off, size


_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz_-"
TYPES = {0x8E58: "xml", 0x22BC: "wcf", 0x136A: "htm", 0xC662: "gif"}


def name_of(rid: bytes) -> str:
    """6-byte id = 8 x 6-bit chars: 0=end, 1..10='0'..'9', 11..='a'.."""
    v = int.from_bytes(rid, "big")
    s = ""
    for k in range(7, -1, -1):
        c = (v >> (6 * k)) & 63
        if c == 0:
            break
        s += _CHARS[c - 1] if c - 1 < len(_CHARS) else f"~{c}"
    return s


def records(path):
    data = open(path, "rb").read()
    for rid, typ, off, size in entries(data):
        yield rid, typ, decompress(data[off:off + size])
