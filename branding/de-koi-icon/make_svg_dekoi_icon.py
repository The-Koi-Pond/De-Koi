# Turns the De-Koi icon drawing (masked Deki in a D-shaped speech bubble)
# into a clean SVG with a see-through background, light and dark versions in
# one file, and a simpler look when it's shown tiny.
#
# Same method as the website's make_svg_deki.py: each colour is cut out as a
# mask, enlarged and smoothed, and traced with Inkscape 1.4's tracer.
#
#   python make_svg_dekoi_icon.py source.png <output folder>
import os
import re
import subprocess
import sys
import tempfile
import xml.dom.minidom

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

INKSCAPE = r"C:\Program Files\Inkscape\bin\inkscape.com"
S = 2  # enlarge by this much before tracing
src, out = sys.argv[1], sys.argv[2]

im = Image.open(src).convert("RGB")
w, h = im.size
a = np.asarray(im.resize((w * S, h * S), Image.LANCZOS)).astype(float)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
lum = 0.299 * r + 0.587 * g + 0.114 * b

dark = lum < 100  # the lines and the mask
# Everything not dark that the picture's edge can reach is background.
labels, _ = ndimage.label(~dark)
edge = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
icon = ~np.isin(labels, list(edge))
icon = ndimage.binary_fill_holes(icon)
inside = icon & ~dark

teal = inside & (g - r > 60) & (lum < 145)
jade = inside & (g - r > 40) & (lum >= 145)
orange = inside & (r > 220) & (g < 160) & (b < 120)
sparkle = inside & (r > 235) & (g > 210) & (b < 214) & ~orange & ~jade
cream = inside & ~teal & ~jade & ~orange & ~sparkle


def components(mask):
    lab, n = ndimage.label(mask)
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    boxes = ndimage.find_objects(lab)
    return lab, sizes, boxes


def keep(mask, min_size):
    """Drop specks smaller than min_size pixels (anti-aliasing leftovers)."""
    lab, sizes, _ = components(mask)
    return np.isin(lab, np.nonzero(sizes >= min_size)[0] + 1)


big = (60 * S) ** 2 // 10
teal, jade, orange, sparkle = keep(teal, big), keep(jade, big // 4), keep(orange, big // 8), keep(sparkle, big // 4)

# Small details that get hidden when the icon is tiny: the mouth (the lowest
# orange shape) and the jade spot on Deki's head (the smallest jade shape).
lab, sizes, boxes = components(orange)
mouth_id = max(range(len(boxes)), key=lambda i: boxes[i][0].start) + 1
mouth = lab == mouth_id
orange = orange & ~mouth
# The head spot is the only jade shape with no outline: it sits straight on
# the cream, so the ring of pixels just around it is nearly all cream.
lab, sizes, boxes = components(jade)
def cream_around(i):
    comp = lab == i + 1
    ring = ndimage.binary_dilation(comp, iterations=4 * S) & ~comp
    return cream[ring].mean()
spot_i = max(range(len(sizes)), key=cream_around)
print(f"jade shapes: {len(sizes)}; head spot is {sizes[spot_i] / S / S:.0f} px, {cream_around(spot_i):.0%} cream around it")
spot = lab == spot_i + 1
jade = jade & ~spot

# The outer outline: dark pixels close to the outside. In dark mode it turns
# cream, like the studio's drawn lettering; the lines inside stay dark brown.
outside_dist = ndimage.distance_transform_edt(icon)
# Its width: walk in from the outside along the top edge (only the bubble's
# outline is there) at several columns, and take the middle value.
ys_, xs_ = np.nonzero(icon)
runs = []
for x in np.linspace(xs_.min() + (xs_.max() - xs_.min()) * 0.3, xs_.min() + (xs_.max() - xs_.min()) * 0.6, 7).astype(int):
    col = np.nonzero(icon[:, x])[0]
    y, n = col[0], 0
    while dark[y + n, x]:
        n += 1
    runs.append(n)
run = int(np.median(runs))
# How much of the outer outline turns cream in dark mode: 1 is all of it, 0.5
# the outer half (a thin cream edge, with the dark line kept inside it).
RIM = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
rim = icon & (outside_dist <= run * RIM + 1 * S)

# Under the small details, the colour around them continues, so hiding a
# detail at small sizes shows that colour rather than a dark hole.
# The sparkles sit wholly inside the teal, so filling the teal's holes covers
# them. The spot and mouth sit on the cream, which also surrounds the mask,
# so there only their own area (and its blurry edge) is added.
teal = ndimage.binary_fill_holes(teal)
cream = cream | (ndimage.binary_dilation(spot | mouth, iterations=2 * S) & ~dark)
print(f"outer outline is about {run / S:.0f}px wide in the drawing")

# One sparkle instead of two, as big as the open water allows, so it still
# reads when the icon is small. Keep the biggest sparkle's shape, and try it
# ever bigger: at each size, find where it fits in the water with a gap of
# about a third of an outline all round (tested on the real star shape, so
# its points can reach into corners). Keep the biggest size that fits.
from scipy.signal import fftconvolve

lab, sizes, _ = components(sparkle)
shape = lab == int(np.argmax(sizes)) + 1
sy, sx = np.nonzero(shape)
cy0, cx0 = sy.mean(), sx.mean()
star = shape[sy.min():sy.max() + 1, sx.min():sx.max() + 1][::S, ::S]  # at drawing size, to be quick
blocked = (~teal)[::S, ::S].astype(float)
gap = max(1, int(run / S / 3))
best = None
for k in np.arange(1.0, 2.6, 0.05):
    st = ndimage.zoom(star.astype(float), k, order=1) > 0.5
    st = np.pad(st, gap)
    st = ndimage.binary_dilation(st, iterations=gap)
    hits = fftconvolve(blocked, st[::-1, ::-1].astype(float), mode="valid")
    ok = hits < 0.5
    if not ok.any():
        break
    # Of the places it fits, take the middle of the biggest patch of them.
    plab, pn = ndimage.label(ok)
    psz = ndimage.sum(ok, plab, range(1, pn + 1))
    py, px = np.nonzero(plab == int(np.argmax(psz)) + 1)
    best = (k, py.mean() + st.shape[0] / 2, px.mean() + st.shape[1] / 2)
k, cy1, cx1 = best
cy1, cx1 = cy1 * S, cx1 * S
yy, xx = np.indices(shape.shape)
sparkle = ndimage.map_coordinates(shape.astype(float), [cy0 + (yy - cy1) / k, cx0 + (xx - cx1) / k], order=1) > 0.5
print(f"sparkle: {len(sizes)} found, kept the biggest, grown {k:.2f}x, centred at "
      f"({cx1 / S:.0f}, {cy1 / S:.0f}) in the drawing (was {cx0 / S:.0f}, {cy0 / S:.0f})")

parts = {
    # name: (mask, css class)
    "lines": (icon, "line"),
    "water": (teal, "water"),
    "cream": (cream, "cream"),
    "jade": (jade, "jade"),
    "orange": (orange, "orange"),
    "spot": (spot, "jade detail"),
    "mouth": (mouth, "orange detail"),
    "sparkle": (sparkle, "sparkle"),
    "rim": (rim, "rim"),
}

tmp = tempfile.mkdtemp()


def trace(name, mask):
    img = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8))
    img = img.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(S * 0.8))
    img.point(lambda v: 0 if v < 128 else 255).save(os.path.join(tmp, name + ".png"))
    with open(os.path.join(tmp, "in.svg"), "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
                f'width="{w * S}" height="{h * S}"><image id="img" x="0" y="0" width="{w * S}" '
                f'height="{h * S}" xlink:href="{name}.png"/></svg>')
    subprocess.run([INKSCAPE, "--actions=select-by-id:img;object-trace:2,false,false,true,20,1.0,0.2;"
                    "export-plain-svg;export-filename:out.svg;export-do", "in.svg"],
                   check=True, capture_output=True, cwd=tmp)
    paths = re.findall(r'<path[^>]*?\sd="([^"]+)"', open(os.path.join(tmp, "out.svg")).read())
    assert len(paths) == 1, (name, len(paths))
    return paths[0]


layers = "\n".join(f'<path class="{cls}" d="{trace(name, mask)}" fill-rule="evenodd"/>'
                   for name, (mask, cls) in parts.items())

# Colours. Light: the studio's art ink for every line. Dark: the outer
# outline turns cream so the shape stands out on a dark page; everything
# inside stays the same, because it sits on its own colours, not the page.
STYLE = """
.line { fill: #361f17; }
.rim { fill: #361f17; }
.water { fill: #16424b; } /* Night Water: the middle of Koihongo's moonlit sky */
.cream { fill: #fef6ed; }
.jade { fill: #5ccbbc; }
.orange { fill: #f06f3f; }
.sparkle { fill: #fdedc6; }
@media (prefers-color-scheme: dark) {
  .rim { fill: #f1ebe5; }
}
/* Tiny (favicon, small app icons): drop the mouth and the head spot, which
   only turn into noise at that size. The sparkle stays. */
@media (max-width: 40px) {
  .detail { display: none; }
}
"""

ys, xs = np.nonzero(icon)
pad = 8 * S
side = max(xs.max() - xs.min(), ys.max() - ys.min()) + 2 * pad
cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
box = f"{cx - side / 2:.0f} {cy - side / 2:.0f} {side} {side}"  # square, centred
path = os.path.join(out, "de-koi-icon.svg")
with open(path, "w", newline="\n") as f:  # LF line endings, as the repo wants
    f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" role="img" aria-label="De-Koi">\n'
            f'<title>De-Koi</title>\n<style>{STYLE}</style>\n{layers}\n</svg>\n')
xml.dom.minidom.parse(path)  # must be valid XML, or browsers show nothing
print("wrote", path, f"({os.path.getsize(path) // 1024} KB)")
