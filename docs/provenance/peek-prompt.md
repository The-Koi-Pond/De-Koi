# Peek Prompt Viewer: Behavior Spec

Status: draft 2026-11-24. Part of the code provenance plan
(`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the **Peek Prompt viewer**: the "Assembled Prompt" dialog
that opens from a reply's Peek prompt action and shows the prompt that was (or
would be) sent, split into sections, with the prompt budget, the model settings,
the context attribution and a note. This spec is the only input the builder
uses. It describes behavior, not the old implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/features/modes/shared/chat-ui/components/PeekPromptModal.tsx`
- `src/features/modes/shared/chat-ui/components/PeekPromptModal.spec.tsx`

You may read every interface listed under "Neighbors". If this spec doesn't
answer a question, ask the spec writer.

**Safety.** The viewer only shows things. It saves nothing, sends nothing and
starts no model request: everything it shows comes from its `data` prop and the
preset list. Its risk is showing the prompt wrongly (a missing, merged or
mislabelled section makes people debug the wrong thing), so the contract is
exactly what it shows for every input. Someone other than the builder recorded
the old viewer as a black box first (see "Black-box recording plan"); the
recordings become tests, and the builder sees the recordings, never the old
code. Where this text and a recording disagree, the recording wins, except
where a decision below changes the behavior on purpose; tell the spec writer so
the spec gets fixed.

## Scope

`src/features/modes/shared/chat-ui/components/PeekPromptModal.tsx` (861 lines,
447 not yet team-owned) and its small spec file. Its data comes from
`use-chat-timeline-actions.ts` (not rebuilt here).

The new module lives in `src/features/modes/shared/chat-ui/components/peek-prompt/`
and exports `PeekPromptModal` with the same props:

```ts
{ data: PeekPromptData; onClose: () => void }
```

(`PeekPromptData` from `src/features/modes/shared/chat-ui/types.ts`). The spec
writer deletes the old two files and points `ChatCommonOverlays.tsx` at
`./peek-prompt` (the builder doesn't open the old files). The old spec's two
checks (Escape closes, labelled dialog with a named Close button) are covered by
the recordings.

### Neighbors (not rebuilt)

- `src/features/modes/shared/chat-ui/types.ts`: `PeekPromptData`.
- `src/features/catalog/presets/index`: `usePresetSummaries()` returns
  `{ data }`, a list of preset summaries (`id`, `name`) or `undefined` while
  loading.
- `src/shared/hooks/use-escape-overlay.ts`: `useEscapeOverlay(onEscape, active?)`
  puts the caller on the shared overlay stack; Escape goes to the topmost active
  overlay only, and when its handler doesn't return `false` the key event is
  marked handled (default prevented, propagation stopped).
- `src/features/modes/shared/chat-ui/lib/prompt-attribution.ts`:
  `buildPromptAttributionViewModel(attribution)` returns `null` (no items) or
  `{ sourceLabel, sourceTone, groups: [{ label, items: [{ label, statusLabel, snippet }] }] }`.
- Types: `PromptBudgetEstimate` (`src/engine/generation/prompt-budget.ts`),
  `GenerationContextAttribution` (`src/engine/contracts/types/chat.ts`),
  `ChatMLMessage["contextKind"]` (`src/engine/contracts/types/prompt.ts`).
- `src/shared/lib/utils.ts` (`cn`), `lucide-react`.
- `ChatCommonOverlays.tsx` renders the viewer while `peekPromptData` is set and
  passes the close handler; the producer first sets `{ loading: true }`, then
  the data (a saved snapshot or a live preview) or `{ error }`.

## The viewer

A fixed full-screen backdrop (dimmed, blurred, above the app; on phone widths it
keeps clear of the top safe area) with a centered dialog: `role="dialog"`,
`aria-modal="true"`, `aria-label="Assembled prompt"`, up to 48 rem wide with a
1 rem side margin, at most 85 % of the viewport high. The dialog is a fixed
header and a body that scrolls.

**Closing.** Clicking the backdrop calls `onClose` (see decision 4); clicks
inside the dialog don't. The Close button (`aria-label="Close"`, an X icon)
calls `onClose`. Escape calls `onClose` when the viewer is the topmost active
overlay, and the key event is then marked handled. Each call to `onClose` uses
the latest prop. Nothing else is called.

### Header

1. **Assembled Prompt** (a heading).
2. **Source badge**, hidden while loading and while there's an error text:
   `exact` true → Exact Text Model Request (green); otherwise `source`
   `live_preview` → Live Preview, `raw_messages` → Raw Messages, anything else
   (including `cached` and none) → Prompt Preview (amber).
3. **Summary**: while loading, `assembling`; otherwise
   `<N> section(s) · ~<T> tokens` (singular only for exactly 1), where N is the
   number of blocks in the block list (sections and chat history blocks) and T
   is the total below. It shows with an error too (usually `0 sections · ~0 tokens`).
4. The **Close** button.

### Token numbers

An estimate is `ceil(length / 4)` of the text (JavaScript string length). Every
number is shown with `toLocaleString()` (tests run in en-US: `12,345`; a
fraction keeps its decimals, `1,234.6`). The **total** T is
`budget.estimatedPromptTokens` when there is a budget, else the estimate of all
`messages` contents joined with nothing between them. It always uses
`messages`, even when the blocks come from `previewMessages`.

### Body

- **Loading** (`loading === true`) wins: only a spinning loader in a 12 rem
  high centered area.
- **Error** (a non-empty `error`, not loading): only a red error box with the
  text (newlines collapse like normal text).
- Otherwise, top to bottom: the budget panel (when there's a `budget`), the
  settings panel, the attribution panel, the note, then the block list.

## Blocks

The shown messages are `previewMessages` when it's a non-empty list, else
`messages`. A **section block** has a label, a role and content; a **chat
history block** has entries (role and content).

### Splitting a message into sections

Used with a fallback label. A **tagged section** is `<name>` on its own at the
start of the text or right after a newline, then a newline, then any text (the
shortest match), then a newline and `</name>`, followed by a newline or the end
of the text. `name` starts with a letter or `_` and continues with letters,
digits, `_` or `-`; the match ignores case (also between the opening and closing
name). Tags with attributes, inline tags and `<t>\n</t>` (no line in between)
are not sections. The newline after a closing tag belongs to that section, so a
section that starts on the very next line isn't found: it stays in the text
after the first one (`<a>…</a>` + newline + `<b>…</b>` gives an `a` block and a
fallback block holding the whole `<b>` section). Sections separated by a blank
line or other text are all found.

For each tagged section in order, the text before it (since the previous one,
trimmed) becomes a fallback block when it isn't blank, and the section becomes a
block labelled with the name as written in the opening tag, whose content is the
whole tagged text, tags included, with trailing whitespace trimmed. Text after
the last one (trimmed) becomes a fallback block when it isn't blank. When this
gives no blocks at all, the result is one fallback block holding the text as it
is (not trimmed, so a blank message shows as an empty block). Every block takes
the message's role.

### Prompt messages

A prompt message is handled like this:

1. `contextKind` `injection` with `displayName` exactly `Trackers`: one block
   labelled `Trackers` with the trimmed content.
2. Content containing both `<last_message>` and `</last_message>` (any case):
   the text before the first opening tag (trimmed) is split with the fallback
   label; the text from after the first `>` at the opening tag up to the first
   closing tag (trimmed) becomes a `last_message` block when not blank; the text
   after the first `>` at the closing tag (trimmed) is split with the fallback
   label.
3. Content containing `<last_message>` only, or starting with `## Last Message`
   and a newline (any case): one `last_message` block, content trimmed after
   removing a leading `## Last Message` line.
4. Otherwise: split with the fallback label.

The fallback label is the message's `displayName` when not empty, else its role.

### With context kinds

When any shown message has a `contextKind`, the messages are read in order:
each run of consecutive `history` messages becomes one chat history block whose
entries are the run's messages with non-blank content (trimmed); a run with none
adds nothing. Every other message is a prompt message.

### Without context kinds (older snapshots)

The chat history is found across messages:

- **start**: the first message containing `<chat_history>` or starting with
  `## Chat History` and a newline;
- **end**: the last message containing `</chat_history>`;
- **last message**: the last message containing `<last_message>` or starting
  with `## Last Message` and a newline.

With a start but no end, the end is the message before the last message when
that comes after the start; otherwise the end is the last of the user and
assistant messages that directly follow the start (or the start itself).

The messages from start to end become one chat history block; each entry has a
leading `<chat_history>` (and the newline after it), a trailing `</chat_history>`
(with the newline before it and any whitespace after it) and a leading
`## Chat History` line removed, then is trimmed; blank ones are skipped, and an
empty block is left out. The last message is handled like steps 2 and 3 of a
prompt message, but its split parts use the role as fallback label (never
`displayName`). Every other message is a prompt message. An end before the start
means no chat history block.

### How blocks look

Every block starts closed. Its header is a button: a chevron (right when
closed, down when open), the label in a small uppercase badge and the estimate
`~<n> token(s)` on the right. Labels show with `_` and `-` replaced by spaces
and the first letter of each word in upper case (`system_prompt` → System
Prompt, `last_message` → Last Message, `user` → User). Badge colors: a label
matching `last` + one optional character + `message` is blue; otherwise role
`system` amber, `user` blue, anything else purple. Opening shows the content as
preformatted text that keeps whitespace and wraps (also inside long words).

A chat history header shows a green **Chat History** badge, `<n> message(s)`
and the estimate of all entries joined with blank lines. Opened, it lists the
entries; each entry is a small button with a chevron, its role badge (role as
written; user blue, assistant purple, others amber), while closed a one-line
preview (the first line, at most 80 characters, cut off with an ellipsis when it
doesn't fit) and `~<n>` (no word) on the right. An opened entry shows its
content as preformatted text.

Open and closed states belong to the position in the list: when the data
changes while the viewer stays open, the block at the same position keeps its
state; they reset when the blocks are hidden (loading, error).

## Budget panel

When `budget` is set:

- **Header row**: a gauge icon and **Prompt Budget**; the remaining text
  (`remainingTokens` null → unknown remaining; below zero →
  `<amount> over`; else `<amount> left`) colored red when below zero, else
  amber when any warning is `near_limit` or `large_section`, else green; then
  `~<estimated> prompt tokens / <contextLimit> context` (`/ unknown context`
  when the limit is null; 0 and negative limits show as numbers).
- **Bar**, only when `contextLimit` is above zero: filled to
  `round(estimated / limit × 100)` percent, kept between 0 and 100, in the same
  color as the remaining text (`width` set inline).
- **Three tiles**: Input budget, Output reserve, Safety reserve, each the number
  or `Unknown` when null (three across from the `sm` breakpoint, stacked
  below it).
- **Warnings**: the first four only, each an amber row with a warning icon and
  the message.
- **Sections**: one row each, in order: the label (cut off when too long), a
  `trim risk` tag for `high` and `watch` for `medium`, a thin bar filled to
  `round(tokens / max(1, estimated) × 100)` percent kept between 2 and 100, and
  `~<tokens>` on the right.

## Settings panel

Shown when `generationInfo` is set to anything truthy (an empty object counts)
or when there is at least one pill. A first line holds, in order:

- the model when set, with `<provider> / ` in muted text before it when there's
  a provider;
- `Preset / <name>` when the preset label resolves (below); its `title` is the
  raw `promptPresetId`;
- `~<T> est. tokens`, then ` | <n> actual prompt tokens` when `tokensPrompt` is
  not null, ` | <n> cached` when `tokensCachedPrompt` is above zero and
  ` | <n> cache write` when `tokensCacheWritePrompt` is above zero.

**Pills** (label and value) come from `generationInfo` when it's truthy, else
from `parameters` when that's truthy (read as a record, whatever its type).
Values are `String(value)` except Max Output Tokens, which is formatted.

- From `generationInfo`, in order: Temperature (not null), Max Output Tokens
  (not null), Top P (not null and not 1), Top K (not null and not 0), Freq
  Penalty and Pres Penalty (not null and not 0), Thinking `On` (showThoughts
  truthy), Reasoning, Verbosity, Service Tier (each when truthy), Assistant
  Prefill `On` (truthy).
- From `parameters`, in order: Temperature, Top P, Top K, Min P (not null and
  not 0), Max Output Tokens, Freq Penalty, Pres Penalty, Thinking, Reasoning,
  Verbosity, Service Tier, Assistant Prefill, with the same rules.

**Preset label.** `promptPresetId` trimmed; when empty, none. Otherwise the
first preset summary with that id gives its trimmed name; with no match or a
blank name, the trimmed id. It only shows inside this panel, so with no settings
panel the preset isn't shown.

## Attribution panel

When the view model isn't null: **Context Attribution**, a badge with the source
label (green for the `exact` tone, amber otherwise) and `<n> source(s)` (all
items). Then one box per group in order: the group label and its item count,
and each item's label with its status tag and either the snippet (clipped to
about two lines, no "more" marker) or `Hidden source details redacted.` when the
snippet is null.

## Note

When `agentNote` isn't empty: an amber box `Note: <agentNote>`.

## Layout

Use the screenshots (old build, real Chrome, at 1366 and 660 wide, dark and
light): a saved snapshot (top, sections opened, bottom), a live preview (top
and bottom), an older conversation snapshot with the chat history open, loading,
an error, a hovered block header and the focused Close button. Colors, spacing
and type sizes match them; the recordings pin the color classes of badges,
tones and tags.

## Decisions

The rebuild keeps everything it shows. These change on purpose:

1. **Toggles.** Every block, chat history and entry header is a
   `type="button"` with `aria-expanded`.
2. **Hidden decoration.** Icons and the budget bars are `aria-hidden` (their
   meaning is in the text next to them).
3. **States.** The loading area is `role="status"` named
   `Assembling prompt`; the error box is `role="alert"`.
4. **Backdrop.** A click closes the viewer only when both the press and the
   release are on the backdrop. Today, in real Chrome, selecting prompt text
   and letting go outside the dialog closes it, and so does pressing on the
   backdrop and letting go inside the dialog.

## Follow-ups after the rebuild

Kept as recorded in the rebuild; each is its own small pull request after it.

1. **Odd data blanks the chat screen.** A non-text message content, role or
   `displayName`, a `null` message, a missing messages list, a budget without
   `warnings` or `sections`, or an attribution item without a status or with a
   non-text snippet throws while rendering (see Recorded details). Saved
   snapshots are stored data, so an old or imported one could do this.
2. **Header total vs blocks.** The total counts `messages`, while the blocks can
   come from `previewMessages`, so the summary and the blocks disagree.
3. **"Redacted" for a missing snippet.** An item without a snippet says
   `Hidden source details redacted.` even when it wasn't redacted.
4. **Hidden warnings.** Only four budget warnings show, with no "and N more".
5. **Preset only with settings.** The preset name only shows inside the
   settings panel.
6. **Pill values.** Text values like `"1"` or `"0"` count as non-default, and
   objects show as `[object Object]`.
7. **Images.** Images attached to a message aren't shown or mentioned.
8. **Older snapshots.** A `<chat_history>` that doesn't start its message leaves
   the tag in the entry, and a `<chat_history>` with nothing inside drops that
   message entirely.
9. **Focus.** Opening doesn't move focus into the dialog, Tab can leave it, and
   closing doesn't return focus to the Peek prompt button.
10. **Back-to-back sections merge.** A tagged section right after another one
    (one newline between, the usual layout) isn't split out, so it shows under
    the fallback label (System, User…) instead of its own name. Fixing it
    changes how many sections real snapshots show.
11. **Pale amber in light theme.** The note, the warnings and amber badges use
    light amber text that is hard to read on the light background.

## Recorded details

Found while recording the old viewer; the rebuild keeps them (the recordings
show each one):

- **Crashes.** These throw while rendering (the recording has the presence; the
  message isn't compared): content `5` or `null` (any mode), a history entry
  with content `7`, a `null` message (in `messages` or `previewMessages`),
  `messages: null`, a budget without `warnings` or without `sections`, an
  attribution item without `status`, a snippet `42`, a numeric role or
  `displayName`. A string `maxTokens` in `generationInfo` (`"12"`) and a numeric
  budget section label don't throw.
- **Loading wins** over an error and over any other field; an error hides the
  badge but keeps the summary; an empty error or note counts as none.
- **Settings panel**: an empty `generationInfo` shows the panel with only the
  estimate; a model without provider shows bare; negative cache counts are
  hidden; `tokensPrompt: 0` shows `0 actual prompt tokens`; with
  `generationInfo` set, `parameters` are ignored even when `generationInfo` has
  no pills; `parameters` that are a list, a string, a number or `{}` give no
  pills.
- **Budget**: `remainingTokens: 0` shows `0 left` in green; a limit of 0 or
  below hides the bar but still shows `/ 0 context`; an estimate of 0 makes
  every section bar 2 % wide; a section bigger than the estimate is capped at
  100 %; sections with the same kind are all shown.
- **Preset label**: with the preset list still loading or empty, the id shows;
  with two summaries for one id, the first wins; `"   "` shows nothing; the
  `title` keeps the untrimmed id.
- **Attribution**: an unknown kind groups as `Context`; an unknown status is
  shown title-cased (`weird_status_here` → Weird Status Here); a
  `metadata.redacted` of `"true"` (text) doesn't redact.
- **Blocks**: a tag spanning one line in a run of others (`</x><y>`) isn't
  split; `<1abc>` isn't a tag; CRLF line ends don't form sections; nested tags
  with the same name end at the first closing tag; a `<chat_history>` in a
  prompt message with context kinds is just a section labelled Chat History;
  previews cut at 80 characters of the first line.
- **Escape**: with another overlay on top that handles Escape, the viewer stays
  open; when that overlay returns `false`, nothing closes and the event isn't
  marked handled; an inactive overlay on top is skipped. `Esc` and `escape`
  (other key names) do nothing. After unmount, Escape calls nothing.
- **Focus** (real Chrome): opening leaves focus on the Peek prompt button, Tab
  moves through the chat behind the dialog, and after closing focus isn't put
  back anywhere on purpose.

## Tests

The new module's tests use the recordings. They render `PeekPromptModal` from
`./peek-prompt` with the same harness as the recorder (an error boundary, the
mocked `usePresetSummaries`, optional sibling overlays that use
`useEscapeOverlay`):

- For every recorded scenario and step: the shown state (`shown`, text,
  preformatted texts exactly, buttons with their text and ARIA, labelled
  elements, inline bar widths, color classes, icons, focus), the `onClose`
  calls (which handler version) and other overlays' calls, and whether a key
  event was marked handled, match, except where decisions 1 to 4 add attributes
  or change a step. Render errors match by presence.
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with throwaway data and a stub model connection
  (127.0.0.1; nothing here calls a model), at 1366x900 and 660x900, dark and
  light: the same states show the same text and match the old screenshots;
  hover and focus styles match; the close flows match except decision 4.
- A local copy of the Pi's saved prompt snapshots (read only, deleted after):
  every snapshot, turned into viewer data by the team-owned
  `promptSnapshotToPeekPromptData`, shows the same blocks, texts and panels in
  the old and new viewer with every block opened.
- The old files are gone.

## Black-box recording plan

Recorded by someone other than the builder, on `main`, with no real data and no
model calls. Saved under
`src/features/modes/shared/chat-ui/components/peek-prompt/test-fixtures/` as
one-line JSON (listed in `.prettierignore`), each file under about 1 MB.

1. **Component recordings**: the real old viewer rendered in the test
   environment with a mocked `usePresetSummaries` (five preset lists, including
   still loading), the real overlay stack, sibling overlays above and below,
   and an error boundary. Inputs: about 150 data shapes (every block rule above
   with and without context kinds, preview messages, loading, errors, notes,
   source badges, settings from `generationInfo` and `parameters`, budgets,
   attribution, preset labels, and the crash shapes). Actions: open, open every
   block in order, closing it again, every close path (button, backdrop, a
   click in the dialog, the heading or a preformatted block, Escape, other
   keys, after unmount), a new `onClose`, sibling overlays, and data changes
   while open. After each step: the shown state and every call.
2. **Real Chrome** (the spec writer): screenshots and visible text of the old
   build for the builder, and the close flows (Close, Escape, backdrop, heading,
   dragging a text selection out of the dialog, dragging from the backdrop in,
   focus and Tab order).

The builder gets the recordings, the screenshots and this spec. The recordings
show the old behavior that decisions 1 to 4 change on purpose.
