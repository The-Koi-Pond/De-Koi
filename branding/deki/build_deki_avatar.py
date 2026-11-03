# Builds Deki-senpai's chat avatar from public/deki.svg: a close-up of Deki's
# face on a disc of pond water, in a light and a dark version (De-Koi picks
# one by its theme setting).
#
#   python branding/deki/build_deki_avatar.py
#
# public/deki.svg is a copy of the studio mascot from the website repo
# (the-koi-pond.github.io/deki.svg). Rerun this after replacing it.
import re
import xml.dom.minidom
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"

# The square of deki.svg to show, in its own units: Deki's face, with a bit
# of the head above it. Tune these to reframe the close-up.
CX, CY, SIDE = 1235, 1300, 2250
# The same water as the pond in src/styles/globals/08-deki-pond.css.
WATER = {"deki-avatar.svg": "#acd7da", "deki-avatar-dark.svg": "#16424b"}

svg = (PUBLIC / "deki.svg").read_text(encoding="utf-8").replace("\r\n", "\n")
paths = "\n".join(re.findall(r"<path\b[^>]*/>", svg, flags=re.S))
assert paths.count("<path") >= 5, "public/deki.svg doesn't look like Deki any more"
# The ids in deki.svg would clash between the two avatars and Deki on one page.
paths = re.sub(r'\sid="[^"]*"', "", paths)

r = SIDE / 2
for name, water in WATER.items():
    out = PUBLIC / name
    out.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{CX - r:.0f} {CY - r:.0f} {SIDE} {SIDE}" '
        f'role="img" aria-label="Deki-senpai">\n<title>Deki-senpai</title>\n'
        f'<defs><clipPath id="disc"><circle cx="{CX}" cy="{CY}" r="{r:.0f}"/></clipPath></defs>\n'
        f'<circle cx="{CX}" cy="{CY}" r="{r:.0f}" fill="{water}"/>\n'
        f'<g clip-path="url(#disc)">\n{paths}\n</g>\n</svg>\n',
        encoding="utf-8",
        newline="\n",
    )
    xml.dom.minidom.parse(str(out))  # must be valid XML, or browsers show nothing
    print("wrote", out)
