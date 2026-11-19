# Emoji Picker: Behavior Spec

Status: proposed 2026-11-19 (decisions as recommended). Part of the code
provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the emoji picker: the small popover that opens from the
smiley button in the Conversation and Roleplay message boxes, lets you browse
eight categories or search, and hands the emoji you tap to the message box. It
is the only input the builder uses. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec, the recordings and the team-owned code around it. Don't
open, search, or read the history of the old implementation:

- `src/shared/components/ui/EmojiPicker.tsx`

You may read the two callers (see "Neighbors") to see how the picker is used,
and change only their import line. If this spec doesn't answer a question, ask
the spec writer.

**Safety.** The picker only touches the screen: it reads and writes no stored
data and sends no requests. It still follows the plan's order: someone other
than the builder records the old picker as a black box first (see "Black-box
recording plan"), the recordings become tests, and the builder sees the
recordings, never the old code. Where this text and a recording disagree, the
recording wins, except where a decision below changes the behavior on purpose;
tell the spec writer so the spec gets fixed.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`c4530ff586`:

| File                                       | Not owned | Of lines |
| ------------------------------------------ | --------: | -------: |
| `src/shared/components/ui/EmojiPicker.tsx` |       593 |      593 |

Replaced, then deleted in the same change. The new module lives in
`src/shared/components/ui/emoji-picker/` and exports `EmojiPicker` with the
same props, so the callers only change their import path.

### Neighbors (not rebuilt)

- `src/features/modes/conversation/components/ConversationInput.tsx` and
  `src/features/modes/shared/chat-ui/components/ChatInput.tsx`. Each keeps an
  `emojiOpen` flag, a ref to its smiley button (`anchorRef`) and a ref to the
  whole message bar (`containerRef`). The smiley button toggles `emojiOpen`.
  `onSelect` inserts the emoji at the message box's cursor (replacing any
  selection), moves the cursor after it and focuses the message box;
  `onClose` sets `emojiOpen` to false. Neither caller closes the picker after a
  pick.
- `src/shared/lib/utils.ts` (`cn`).

## The shape

```ts
interface EmojiPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  /** The button that opened it: horizontal alignment, and clicks on it don't count as "outside". */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** The bar whose top edge the picker sits above. Falls back to the anchor. */
  containerRef?: React.RefObject<HTMLElement | null>;
}
```

When `open` is false the picker renders nothing. When open, it renders into
`document.body` (a portal), fixed-positioned above everything else in the app.

## Layout

A panel 21rem wide and 22rem tall (never wider than the screen minus 1rem),
rounded, with the app's card background, border and shadow theme tokens. Top
to bottom:

1. **Search box**, focused when the picker opens, placeholder
   `Search emojis...`.
2. **Category tabs**: one button per category, showing the category's icon
   emoji, in category order. The active tab is highlighted.
3. **Emoji grid**, scrolling: a small uppercase heading with the category label,
   then the emojis in an 8-column grid, each a button that grows a little on
   hover.

## Position

Measured when the picker opens (not tracked while open):

- Vertical: the panel's bottom edge sits 8px above the top edge of
  `containerRef` (or of `anchorRef` if there is no container). As CSS:
  `bottom = window.innerHeight - referenceTop + 8`.
- Horizontal, window narrower than 480px: centered,
  `left = max(8, (innerWidth - min(336, innerWidth - 16)) / 2)`.
- Horizontal, 480px and wider: the panel's right edge lines up with the anchor's
  right edge, `right = max(8, innerWidth - anchorRight)`.
- No anchor: the position is not measured (the panel sits at the bottom-left
  corner of the window). Both callers always pass an anchor.

## Categories and emojis

Eight categories, in this order, each with a label and a tab icon:

| #   | Label    | Tab icon |
| --- | -------- | -------- |
| 1   | Smileys  | 😀       |
| 2   | Gestures | 👋       |
| 3   | People   | 👤       |
| 4   | Hearts   | ❤️       |
| 5   | Nature   | 🌸       |
| 6   | Food     | 🍕       |
| 7   | Objects  | 💡       |
| 8   | Symbols  | 💯       |

The emojis in each category, and their order, are exactly the recorded lists
(`recorded-picker.json`, see the recording plan), except that an emoji listed
twice in one category shows once, in its first place (decision 2). The old
picker shows 629 emojis, 623 of them different: 3 repeat inside their own
category (🐾 in Nature, 💫 and 💦 in Symbols) and 3 more sit in two categories.
An emoji in two categories stays in both.

When the picker opens the first time, Smileys is active. Clicking a tab shows
that category's emojis (only that one category, under its heading).

## Search

- The query is the search box text, trimmed and lowercased. An empty query
  shows the active category.
- An emoji matches when the query appears anywhere (substring, not whole
  words) in that emoji's keyword text: lowercase English words and phrases for
  the emoji, such as its common name. "heart eyes" matches an emoji whose
  keywords contain "heart eyes"; "eart" matches anything with "heart".
- Results: every category that has a match, in category order, each under its
  heading, its matching emojis in category order. Categories without a match are
  left out.
- Every emoji has keywords (decision 3). Every emoji the old picker found for a
  recorded query must still be found for that query; more matches are fine.
- No match at all: the grid says `No emojis found` (decision 4).
- While a query is typed, clicking a category tab clears the query and shows
  that category (decision 6).

The builder writes the keyword list from scratch. Don't reproduce the old
keyword text; the recordings say which emojis a query must find, not which
words to use.

## Picking and closing

- Clicking an emoji calls `onSelect(emoji)` with the exact emoji string,
  including any variation selector (for example `❤️` is U+2764 U+FE0F). The
  picker stays open, so several emojis can be added in a row.
- `Escape` anywhere in the page calls `onClose`.
- A mouse press (`mousedown`) outside the panel and outside the anchor calls
  `onClose`. A press inside the panel or on the anchor doesn't (the anchor's own
  click toggles the picker in the caller). With no anchor, a press outside the
  panel closes it (decision 7).
- Closing and opening again starts with an empty search; the last active
  category stays (decision 5).

## Accessibility (decision 8)

- The panel is a `dialog` labelled `Emoji picker` (not modal: the page behind
  stays usable).
- The search box has the label `Search emojis`.
- Each tab is a button labelled with its category name, with `aria-pressed` on
  the active one; the hover title stays the category name.
- Each emoji button is labelled with the emoji's name (its first keyword
  phrase), and all buttons are `type="button"`.

## Saved data

None. The picker reads and writes nothing in storage or `localStorage`.

## Decisions

1. **Same emoji set and order.** Keep the eight categories, their labels, tab
   icons and emoji order exactly as recorded. Recommended: yes; it's what users
   know, and the recording is the reference.
2. **Duplicates show once.** The old lists repeat 3 emojis inside their own
   category (1 in Nature, 2 in Symbols), which shows them twice and gives two
   buttons the same React key. Recommended: show each once, in its first place.
3. **Every emoji can be found.** 200 of the old 623 emojis (64 in Food, 46 in
   Objects, 88 in Symbols) had no keywords, so no search could find them.
   Recommended: give every emoji keywords, at least its common English name.
4. **Say when nothing matches.** The old grid went blank. Recommended:
   `No emojis found`.
5. **Fresh search on reopen.** The old picker kept the last query, so reopening
   could show a stale, filtered grid. Recommended: clear the query on close,
   keep the last category.
6. **Tabs work while searching.** The old tabs changed the hidden active
   category but the grid kept showing search results, so a click seemed to do
   nothing. Recommended: a tab click clears the query and shows that category.
7. **Outside press closes even without an anchor.** The old picker ignored
   outside presses when no anchor was passed. Both callers pass one, so nothing
   changes for users. Recommended: close on any press outside the panel and the
   anchor (when there is one).
8. **Accessibility.** Names for the dialog, search box, tabs and emojis, and
   `type="button"`. Recommended: yes.
9. **Not in this rebuild** (unchanged, possible follow-ups): the search box
   still takes focus on open (which raises the phone keyboard), there is no
   keyboard navigation in the grid, and no recently-used row.

## Tests

The new module's tests use the recordings:

- Each category's emoji list equals the recorded one with in-category
  duplicates removed (first place kept); tab labels and icons match.
- For every recorded query, the new results contain every emoji the old picker
  showed, and results keep category order and emoji order.
- Every emoji in every category matches at least one query made from its
  keywords, and its first keyword phrase is non-empty.
- Position: for each recorded viewport, the panel's `bottom`, `left` and `right`
  match the recorded values.
- Picking calls `onSelect` with the exact emoji and leaves the picker open;
  Escape, an outside press and a press on the anchor behave as recorded (the
  anchor press does not call `onClose`).
- Decisions 4 to 8 each have a test.

## Acceptance checks

- Real Chrome, desktop and phone size, in a Conversation chat and a Roleplay
  chat: the smiley button opens the picker above the message bar, a pick goes
  into the message at the cursor, Escape and an outside tap close it, the smiley
  button toggles it.
- The recorded scenarios, replayed against the new build, give the same
  inserted text and the same open/closed results.
- `EmojiPicker.tsx` is gone and nothing imports it.

## Black-box recording plan

Recorded by someone other than the builder, in real Chrome (headless, channel
chrome), on a build of `main` before the old file is deleted, with a local
server and a throwaway character and chats (no real data, no model calls). Saved
as `src/shared/components/ui/emoji-picker/test-fixtures/recorded-picker.json`.

1. **Categories.** Open the picker in a Conversation chat; for each tab, record
   its title and icon and the emoji buttons' text, in order.
2. **Search.** For a fixed list of about 40 queries (common words like `happy`,
   `heart`, `cat`, `pizza`, `fire`, partial words like `eart`, multi-word like
   `heart eyes`, mixed case and padded with spaces, and words that match
   nothing), record the headings shown and each category's emojis in order.
3. **Position.** At 1366x900, 800x1000 and 412x915, in both callers, record the
   anchor's and the message bar's rectangles and the panel's rectangle and its
   `bottom`/`left`/`right` style.
4. **Picking.** With text in the message box and the cursor (or a selection) in
   the middle, pick one emoji, then a second; record the message box text, the
   cursor position, whether the picker is still open.
5. **Closing.** Record open/closed after: Escape; a press on the page outside
   the panel; a press inside the panel; a click on the smiley button.
6. **Reopen.** Type a query, close, reopen; record the query and the shown
   category. Switch tabs, close, reopen; record the active tab.
7. **Tabs while searching.** Type a query, click a tab; record what the grid
   shows.

The builder gets the recordings and this spec. Recordings 6 and 7 show the old
behavior that decisions 5 and 6 change on purpose.
