#!/usr/bin/env python3
"""Render the PNG app icons from the same shapes as icon.svg.

No image libraries needed: each pixel is sampled 3x3 and written
straight into a PNG. Run from the repo root:  python3 icons/make-icons.py
"""
import struct
import zlib

SIZES = {'icon-512.png': 512, 'icon-192.png': 192, 'icon-180.png': 180, 'favicon-32.png': 32}

# All geometry is in the 512x512 space of icon.svg: a rounded band
# across the eyes, with two eye holes and a nose notch cut out of it.
CORNER = 114.0
BAND = (82.0, 190.0, 348.0, 134.0, 62.0)          # x, y, w, h, radius
HOLES = [(171.0, 250.0, 43.0, 31.0),              # left eye
         (341.0, 250.0, 43.0, 31.0),              # right eye
         (256.0, 352.0, 52.0, 52.0),              # nose notch
         (256.0, 164.0, 34.0, 34.0)]              # brow dip
FROM = (0x7c, 0x5c, 0xff)
TO = (0xff, 0x6b, 0x9d)


def in_ellipse(x, y, cx, cy, rx, ry):
    dx, dy = (x - cx) / rx, (y - cy) / ry
    return dx * dx + dy * dy <= 1.0


def in_rounded_rect(x, y, left, top, w, h, r):
    cx = min(max(x, left + r), left + w - r)
    cy = min(max(y, top + r), top + h - r)
    if left <= x <= left + w and top <= y <= top + h:
        dx, dy = x - cx, y - cy
        return dx * dx + dy * dy <= r * r
    return False


def sample(x, y, side):
    """Return (r, g, b, a) for one sample point in device pixels."""
    c = CORNER * side / 512.0
    if not in_rounded_rect(x, y, 0.0, 0.0, float(side), float(side), c):
        return (0, 0, 0, 0)
    # background gradient, corner to corner
    t = min(max((x + y) / (2.0 * side), 0.0), 1.0)
    rgb = tuple(int(round(FROM[i] + (TO[i] - FROM[i]) * t)) for i in range(3))

    u, v = x * 512.0 / side, y * 512.0 / side
    if in_rounded_rect(u, v, *BAND) and not any(in_ellipse(u, v, *e) for e in HOLES):
        return (255, 255, 255, 255)
    return (rgb[0], rgb[1], rgb[2], 255)


def render(side, ss=3):
    rows = []
    step = 1.0 / ss
    offset = step / 2.0
    for py in range(side):
        row = bytearray([0])                       # PNG filter byte: none
        for px in range(side):
            r = g = b = a = 0
            for sy in range(ss):
                y = py + offset + sy * step
                for sx in range(ss):
                    s = sample(px + offset + sx * step, y, side)
                    r += s[0] * s[3]
                    g += s[1] * s[3]
                    b += s[2] * s[3]
                    a += s[3]
            if a:
                row += bytes((r // a, g // a, b // a, a // (ss * ss)))
            else:
                row += b'\x00\x00\x00\x00'
        rows.append(bytes(row))
    return b''.join(rows)


def write_png(path, side, raw):
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    header = struct.pack('>IIBBBBB', side, side, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


if __name__ == '__main__':
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    for name, side in SIZES.items():
        write_png(os.path.join(here, name), side, render(side))
        print('wrote', name, side)
