# Asset Credits

## De-Koi Brand Assets

The De-Koi logo and app icons are De-Koi's own project assets, not taken from
Marinara Engine.

This includes the logo's source files in `branding/de-koi-icon/`, the files
built from them under `public/` (`favicon.svg`, `favicon.png`,
`de-koi-logo.svg`, `de-koi-logo-dark.svg`, `icon-192.png`,
`icon-512.png` and `icon-maskable-512.png`) and in `src-tauri/icons/`, and
`koi-mark.svg`.

Deki, The Koi Pond's mascot, is also the team's own: `public/deki.svg` (a copy
of the studio website's `deki.svg`), `public/deki-steady.svg` (a copy of the
website's squishing `deki-steady.svg`), the avatars built from it by
`branding/deki/build_deki_avatar.py` (`deki-avatar.svg`,
`deki-avatar-dark.svg`) and `deki-lily-pad.svg`.

Pond Pebbles, The Koi Pond's own display font, is the team's as well:
`public/fonts/PondPebbles.woff2` is a copy of the font built for the studio
website. The Pond visual theme uses it for
the app name and big panel titles.

Unless a more specific file or directory notice says otherwise, these assets are
distributed with De-Koi under the same project terms as the rest of this
repository.

## Wisp, the cinematic starter character

Wisp's art was made for De-Koi and is original to this project: the avatar and
twelve expression sprites in `public/starters/wisp/`, and the three scene
backgrounds `wisp-apartment.webp`, `wisp-back-street.webp` and
`wisp-lantern-market.webp` in `src-tauri/resources/default-data/backgrounds/`.

They were generated with an image model (Google Gemini 2.5 Flash Image) from
text prompts written for this character, with every expression drawn from the
same neutral sprite so she stays one character. The sprites' backgrounds were
keyed out and the pictures cropped and compressed by hand; no existing artwork,
character or artist's style was used as a reference.

They are distributed with De-Koi under the same project terms as the rest of
this repository.
