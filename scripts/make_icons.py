"""Renders the VaultDock icon (gradient tile with a padlock) to PNG and ICO
files without third-party libraries. Run: python scripts/make_icons.py"""
import math
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def lerp(a, b, t):
    return a + (b - a) * t


def rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shape(x, y, tray):
    """Returns (inside_tile, inside_white) for normalised coords 0..1."""
    tile = rounded_rect(x, y, 0.0, 0.0, 1.0, 1.0, 0.24) if not tray else rounded_rect(x, y, 0.02, 0.02, 0.98, 0.98, 0.22)
    body = rounded_rect(x, y, 0.25, 0.42, 0.75, 0.80, 0.07)
    # keyhole
    hole = (x - 0.5) ** 2 + (y - 0.57) ** 2 <= 0.055 ** 2 or (abs(x - 0.5) <= 0.025 and 0.57 <= y <= 0.69)
    # shackle: ring segment above the body
    d = math.hypot(x - 0.5, y - 0.42)
    shackle = 0.12 <= d <= 0.20 and y <= 0.42
    legs = (0.30 <= x <= 0.38 or 0.62 <= x <= 0.70) and 0.42 <= y <= 0.46
    white = (body and not hole) or shackle or legs
    return tile, white


def render(size, tray=False, ss=4):
    c0 = (0x63, 0x66, 0xF1)
    c1 = (0x0E, 0xA5, 0xE9)
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    tile, white = shape(x, y, tray)
                    if white:
                        col, a = (255, 255, 255), 1.0
                    elif tile:
                        t = (x + y) / 2
                        col, a = tuple(lerp(c0[i], c1[i], t) for i in range(3)), 1.0
                    else:
                        continue
                    for i in range(3):
                        acc[i] += col[i] * a
                    acc[3] += a
            n = ss * ss
            alpha = acc[3] / n
            if acc[3] > 0:
                row += bytes(int(acc[i] / acc[3] + 0.5) for i in range(3))
            else:
                row += b"\x00\x00\x00"
            row.append(int(alpha * 255 + 0.5))
        rows.append(bytes(row))
    return rows


def png_bytes(rows, size):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def ico_bytes(images):
    """images: list of (size, png_bytes). PNG-compressed ICO entries."""
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    data = b""
    offset = 6 + 16 * len(images)
    for size, png in images:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(png), offset + len(data))
        data += png
    return header + entries + data


def main():
    out = lambda *p: os.path.join(ROOT, *p)
    os.makedirs(out("desktop", "build", "windows"), exist_ok=True)
    os.makedirs(out("desktop", "assets"), exist_ok=True)
    big = 512
    print("rendering", big)
    with open(out("desktop", "build", "appicon.png"), "wb") as f:
        f.write(png_bytes(render(big, ss=3), big))
    imgs = []
    for s in (16, 24, 32, 48, 64, 128, 256):
        imgs.append((s, png_bytes(render(s, ss=6 if s < 64 else 4), s)))
    ico = ico_bytes(imgs)
    for p in (out("desktop", "build", "windows", "icon.ico"), out("desktop", "assets", "tray.ico")):
        with open(p, "wb") as f:
            f.write(ico)
    print("done")


if __name__ == "__main__":
    sys.exit(main())
