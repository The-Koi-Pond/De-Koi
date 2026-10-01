# Character Card Export Formats

De-Koi exports characters as De-Koi Native, Chara Card V2 JSON
(`compatible`), Compatible PNG, Character Card V3 JSON (`v3`), or a CHARX
package (`charx`). V3 and CHARX are built by
`src-tauri/src/commands/storage/exports/card_v3.rs` from one portable V3 card,
and both are available from the single-character and bulk export flows. Remote
runtimes use the same `character_export` and `characters_export_bulk`
commands with the same `format` values.

## What a V3 Card Contains

- All Character Card V2 text fields, `tags`, `alternate_greetings`,
  `group_only_greetings`, `source`, `nickname` and
  `creator_notes_multilingual` when present, and `creation_date` /
  `modification_date` (Unix seconds) from the stored timestamps.
- `character_book` built from the character's current linked lorebook, so
  edits made in De-Koi are exported. Placement details SillyTavern keeps per
  entry (`position`, `depth`, `role`, `probability`, `group`, `scan_depth`,
  recursion and timing) are written under each entry's `extensions`. If no
  lorebook is linked, the card's original `character_book` is kept.
- `extensions` from the card, minus `importMetadata` (it holds De-Koi record
  ids). A profile banner stored by De-Koi is replaced by a package reference
  (CHARX) or removed (V3 JSON). Remote banner URLs stay as they are.
- Never: record ids, local file paths, chat or message data, or memories.
  Memories are only included in De-Koi Native exports, when requested.

## Supported Asset Matrix

| De-Koi asset | V3 asset | CHARX path | V3 JSON | Re-imports into De-Koi |
| --- | --- | --- | --- | --- |
| Avatar | `icon` / `main` | `assets/icon/images/main.<ext>` | `ccdefault:` marker, reported as not included | Yes, as the avatar |
| Public profile banner | `x-banner` / `banner`, referenced from `extensions.publicProfile.bannerImage` | `assets/other/images/banner.<ext>` | Removed, reported | Yes, as the banner |
| Expression sprites | `emotion` / expression name | `assets/emotion/images/<expression>.<ext>` | Not included, reported | Yes, as sprites with the same expression names |
| Gallery images | None in the standard | Not included, reported | Not included, reported | Use De-Koi Native |
| Character memories | None | Not included, reported if requested | Not included, reported if requested | Use De-Koi Native |

Images are PNG, JPEG, WebP, GIF, or AVIF. CHARX import also reads `emotion`
assets written by other apps.

## Export Report

Every V3 or CHARX download carries a `report` with `included` and `skipped`
rows (`character`, `asset`, and for skipped rows a `reason`). The character
export flows show skipped rows in the export toast, so nothing is dropped
silently.

## Package Limits

CHARX writing uses the CHARX import limits, so every package De-Koi writes is
one it can read back: at most 512 entries, 50 MB per asset, and 256 MB of
assets in total. An asset over a limit is skipped and reported. Asset file
names are sanitized to ASCII and de-duplicated case-insensitively.
