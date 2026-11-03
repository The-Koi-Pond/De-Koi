# Makes every De-Koi icon file from the master SVG (de-koi-icon.svg, next to
# this script): the favicon, the home-screen logo (light and dark), the web
# app icons, the Windows installer pictures, and the Tauri app icons for
# desktop, Android and iOS.
#
#   python branding/de-koi-icon/build_icons.py
#
# Run it from anywhere after changing the master SVG. It needs Pillow,
# Inkscape at the path below (to draw the SVG), and the repo's pnpm install
# (the last step runs `pnpm tauri icon`).
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

INKSCAPE = r"C:\Program Files\Inkscape\bin\inkscape.com"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PUBLIC = ROOT / "public"
ICONS = ROOT / "src-tauri" / "icons"

CREAM = "#fef6ed"  # behind the icon where a picture can't be see-through
INSTALLER_DARK = "#050312"
ORANGE = "#f06f3f"

master = (HERE / "de-koi-icon.svg").read_text(encoding="utf-8")

# The master's outline follows the computer's light/dark setting, which suits
# a browser tab. The app follows its own theme instead, so it gets one file
# per look, each with that setting taken out.
DARK_RULE = re.compile(r"@media \(prefers-color-scheme: dark\) \{\s*\.rim \{[^}]*\}\s*\}\n?")
assert len(DARK_RULE.findall(master)) == 1, "the master SVG's dark-mode rule changed; update build_icons.py"
light_svg = DARK_RULE.sub("", master)
dark_svg = DARK_RULE.sub("", master).replace(".rim { fill: #361f17; }", ".rim { fill: #f1ebe5; }")
assert dark_svg != light_svg, "couldn't find the outline colour in the master SVG"

tmp = Path(tempfile.mkdtemp())
(tmp / "light.svg").write_text(light_svg, encoding="utf-8")
(tmp / "dark.svg").write_text(dark_svg, encoding="utf-8")


def render(variant, size):
    """The icon drawn at size x size pixels, with a see-through background."""
    out = tmp / f"{variant}-{size}.png"
    if not out.exists():
        subprocess.run(
            [INKSCAPE, str(tmp / f"{variant}.svg"), "--export-type=png", f"--export-filename={out}",
             f"--export-width={size}", f"--export-height={size}", "--export-background-opacity=0"],
            check=True, capture_output=True,
        )
    return Image.open(out).convert("RGBA")


def on_square(variant, size, share, colour):
    """The icon at `share` of the width, centred on a square of one colour."""
    canvas = Image.new("RGBA", (size, size), colour)
    inner = round(size * share)
    canvas.alpha_composite(render(variant, inner), ((size - inner) // 2, (size - inner) // 2))
    return canvas


def font(size, bold=False):
    return ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf", size)


def centred_text(draw, y, text, size, colour, bold=False):
    f = font(size, bold)
    width = draw.textlength(text, font=f)
    draw.text(((draw.im.size[0] - width) / 2, y), text, font=f, fill=colour)  # im.size: the picture's size


# Browser tab icon, home-screen logo and the big logo. The repo wants LF
# line endings, which Windows Python doesn't write unless asked.
for name, text in [("favicon.svg", master), ("de-koi-logo.svg", light_svg), ("de-koi-logo-dark.svg", dark_svg)]:
    (PUBLIC / name).write_text(text.replace("\r\n", "\n"), encoding="utf-8", newline="\n")
render("light", 64).save(PUBLIC / "favicon.png")
render("light", 1024).save(PUBLIC / "logo.png")

# Web app (PWA) icons. Home screens and notifications need a solid
# background. The maskable one is smaller, because phones crop it to a
# circle or squircle.
on_square("light", 192, 0.8, CREAM).save(PUBLIC / "icon-192.png")
on_square("light", 512, 0.8, CREAM).save(PUBLIC / "icon-512.png")
on_square("light", 512, 0.6, CREAM).save(PUBLIC / "icon-maskable-512.png")

# Windows installer pictures (24-bit BMP, the only kind NSIS takes).
sidebar = Image.new("RGBA", (164, 314), INSTALLER_DARK)
sidebar.alpha_composite(render("dark", 112), (26, 40))
draw = ImageDraw.Draw(sidebar)
centred_text(draw, 168, "De-Koi", 26, ORANGE, bold=True)
centred_text(draw, 210, "AI chat, roleplay", 12, "#c9cfd8")
centred_text(draw, 228, "and stories", 12, "#c9cfd8")
sidebar.convert("RGB").save(ICONS / "nsis-sidebar.bmp")
header = Image.new("RGBA", (150, 57), "#ffffff")
header.alpha_composite(render("light", 49), (4, 4))
header.convert("RGB").save(ICONS / "nsis-header.bmp")

# Tauri's own sources, then its generator for every desktop and phone size
# (settings in app-icon-manifest.json).
render("light", 1024).save(ICONS / "app-icon-source.png")
# Android crops the outer third of this layer to a circle or squircle, and
# Tauri copies it at full size, so the margin goes in here.
on_square("light", 1024, 0.56, (0, 0, 0, 0)).save(ICONS / "app-icon-foreground.png")
Image.new("RGB", (1024, 1024), CREAM).save(ICONS / "app-icon-background.png")
subprocess.run("pnpm tauri icon src-tauri/icons/app-icon-manifest.json", shell=True, check=True, cwd=ROOT)

shutil.rmtree(tmp)
print("Done. Check `git status` for what changed.")
