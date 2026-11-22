# Agent Editor: Behavior Spec

Status: draft 2026-11-21. Part of the code provenance plan
(`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the agent editor: the full-page screen that opens when
someone clicks an agent (built-in or custom) or **New** in the Agents panel. It
edits one agent's name, description, author, on/off state, pipeline phase,
connections, budget, cadence, prompt template, tools and the settings that only
some agent types have, and it saves, creates, deletes and exports the agent. It
is the only input the builder uses. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/features/catalog/agents/components/AgentEditor.tsx`

You may read every interface listed under "Neighbors". If this spec doesn't
answer a question, ask the spec writer.

**Safety.** The editor sends no model requests. But what it saves is the agent
configuration every agent run reads: which agents run, when, on which
connection, with which prompt, tools, lorebooks, files and image settings. A
changed field changes what happens on every reply in every chat that uses the
agent. So the stored payload is a compatibility contract and must stay exactly
the same (see "Save"). Someone other than the builder records the old editor as
a black box first (see "Black-box recording plan"), the recordings become
tests, and the builder sees the recordings, never the old code. Where this text
and a recording disagree, the recording wins, except where a decision below
changes the behavior on purpose; tell the spec writer so the spec gets fixed.

This is a data-touching module, so the safety rules' "rebuild first, fix
after" applies: the rebuild keeps today's behavior exactly, including the
quirks listed under "Follow-ups". The only changes on purpose are the
accessibility decisions below, which change no stored value and no visible
text.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`a5c9de4063`:

| File                                                     | Not owned | Of lines |
| -------------------------------------------------------- | --------: | -------: |
| `src/features/catalog/agents/components/AgentEditor.tsx` |     1,300 |    1,705 |

Replaced, then deleted in the same change. The new module lives in
`src/features/catalog/agents/components/agent-editor/` and exports
`AgentEditor` (no props) with the same name. `src/features/catalog/agents/shell.ts`
re-exports it from the new path; nothing else changes for the callers.

### Neighbors (not rebuilt)

- `src/app/shell/detail-route-registry.tsx` lazy-loads the editor through
  `shell.ts` and shows it while `agentDetailId` is set.
- `src/features/catalog/agents/components/AgentsPanel.tsx` opens it:
  `openAgentDetail("__new__")` for a new custom agent,
  `openAgentDetail(<built-in id or custom row id>)` otherwise.
- UI store (`src/shared/stores/ui.store`): `agentDetailId`,
  `openAgentDetail(id)`, `closeAgentDetail()`, `setEditorDirty(dirty)`.
- `src/features/catalog/agents/hooks/use-agents.ts`: `useAgentConfigs`,
  `useUpdateAgent`, `useCreateAgent`, `useDeleteAgent`, `agentEnabledFlag`,
  `agentCreditLabel`, `AgentConfigRow`. The hooks own the storage calls
  (`storageApi.list/update/create/delete("agents", …)`) and their payload
  normalising; the editor hands them the payload described under "Save".
- `src/features/catalog/agents/hooks/use-custom-tools.ts`: `useCustomTools`,
  `useCustomToolCapabilities`, `isCustomToolSelectable`, `CustomToolRow`.
- `src/features/catalog/connections/index`: `useConnections`.
- `src/features/catalog/lorebooks/index`: `useLorebooks`,
  `useEntriesAcrossLorebooks(ids)`.
- `src/features/catalog/knowledge/index`: `useKnowledgeSources`,
  `useUploadKnowledgeSource`, `useDeleteKnowledgeSource`.
- `src/features/catalog/agents/lib/agent-lorebook-writer-settings.ts`:
  `normalizeAgentLorebookWriterEditorState`, `buildAgentLorebookWriterSaveState`,
  `LOREBOOK_WRITE_TOOL_NAME`.
- `src/features/catalog/agents/lib/agent-import-export.ts`:
  `buildAgentExportEnvelope`, `agentExportFilename`, `createCustomAgentType`.
- `src/shared/lib/agent-cadence.ts`: `getAgentRunIntervalMeta`,
  `getCadenceInputValue`, `parseOptionalCadenceInputValue`,
  `stepCadenceValue`.
- `src/engine/contracts/constants/agent-activation.ts`: the activation keyword
  and scan depth defaults, maximum and normalisers.
- `src/engine/contracts/constants/agent-prompts.ts`: `getDefaultAgentPrompt`.
- `src/engine/contracts/types/agent.ts`: `BUILT_IN_AGENTS`, `BUILT_IN_TOOLS`,
  `DEFAULT_AGENT_TOOLS`, `DEFAULT_AGENT_CONTEXT_SIZE`,
  `DEFAULT_AGENT_MAX_TOKENS`, `MIN_AGENT_MAX_TOKENS`, `MAX_AGENT_MAX_TOKENS`,
  `getDefaultBuiltInAgentSettings`, `AgentPhase`, `AgentResultType`,
  `ToolDefinition`.
- `src/engine/generation/illustrator-settings.ts`:
  `illustratorAvatarReferenceMode`, `serializeIllustratorAvatarReferenceSettings`,
  `IllustratorAvatarReferenceMode`.
- `src/shared/components/ui/ExplicitSaveChrome`: `EditorSaveStatus`,
  `SaveErrorBanner`, `UnsavedChangesBar`. `src/shared/components/ui/HelpTooltip`.
- `src/shared/lib/app-dialogs`: `showConfirmDialog`.
  `src/shared/api/file-save-api`: `saveTextFileToUserSelectedLocation`.
  `src/shared/lib/error-message`: `toUserMessage`. `sonner`: `toast`.

## Which agent

`agentDetailId` from the UI store picks the agent:

- **Built-in meta**: the `BUILT_IN_AGENTS` entry whose `id` equals
  `agentDetailId`, if any.
- **Stored row**: the first row of the agents list whose `type` equals
  `agentDetailId` **or** whose `id` equals it, once the list has loaded.
- **Custom agent**: a stored row and no built-in meta.
- **New custom agent**: `agentDetailId` is exactly `"__new__"`.

When there is no `agentDetailId`, or there is no built-in meta, no stored row
and the id isn't `"__new__"`, the whole editor is one centered line, `Agent not
found.` (also while the list is still loading for a custom id).

A built-in agent with no stored row yet shows its defaults and creates its row
on the first Save. A built-in opened by its stored row's `id` (not its type)
has no built-in meta, so it behaves as a custom agent (see "Follow-ups").

## Loading the form

The form fills itself whenever the agent id, the stored row, the built-in meta,
the connections list or the custom cadence default changes (a refetch that
returns equal data keeps the same objects and doesn't refill). Filling clears
the unsaved state and the save error; it does not hide the unsaved bar and
does not touch the saved flash.

"Defaults" below means `getDefaultBuiltInAgentSettings(type)` where `type` is
the stored row's `type`, else the built-in id, else `agentDetailId`.

**With a stored row** (built-in or custom):

| Field                          | Shown value                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                           | the built-in meta's name when there is one, else the row's `name`                                                                                                                                    |
| Description                    | row `description`                                                                                                                                                                                    |
| Author                         | row `credit`, else the built-in meta's `credit`, else empty (only `null`/missing fall through)                                                                                                       |
| Status                         | `agentEnabledFlag(row.enabled, true)`                                                                                                                                                                |
| Phase                          | row `phase` as stored                                                                                                                                                                                |
| Connection                     | row `connectionId`, else empty                                                                                                                                                                       |
| Settings                       | row `settings`: a string is parsed as JSON, an object is used as is, anything falsy is `{}`                                                                                                          |
| Context size                   | settings `contextSize`, else empty (only `null`/missing fall through)                                                                                                                                |
| Max output tokens              | settings `maxTokens`, else defaults `maxTokens`, else empty                                                                                                                                          |
| Image connection               | settings `imageConnectionId`, else empty                                                                                                                                                             |
| Run interval                   | settings `runInterval`, else defaults `runInterval`, else empty                                                                                                                                      |
| Activation keywords            | the activation keyword normaliser applied to settings `activationKeywords`, joined with newlines                                                                                                     |
| Scan depth                     | the scan depth normaliser applied to settings `activationScanDepth`                                                                                                                                  |
| Add as prompt section          | settings `injectAsSection`, else defaults `injectAsSection === true`                                                                                                                                 |
| Tools, lorebook writer         | `normalizeAgentLorebookWriterEditorState(settings, DEFAULT_AGENT_TOOLS[row.type] ?? [])`: enabled tools, writer on/off, target lorebook id                                                           |
| Source lorebooks               | settings `sourceLorebookIds`, else none                                                                                                                                                              |
| Use chat-active lorebooks      | settings `useChatActiveLorebooks` read as a boolean (`true`/`false`, or a string `true`/`1`/`yes`/`on` / `false`/`0`/`no`/`off`, any case, trimmed), else defaults `useChatActiveLorebooks === true` |
| Source files                   | settings `sourceFileIds`, else none                                                                                                                                                                  |
| NPC avatars, backgrounds       | settings `autoGenerateAvatars` / `autoGenerateBackgrounds`, else off                                                                                                                                 |
| Reference images               | `illustratorAvatarReferenceMode(settings)`                                                                                                                                                           |
| Positive / negative image tags | settings `imagePositivePrompt` / `imageNegativePrompt`, else empty                                                                                                                                   |
| Result type                    | `text_rewrite` when settings `resultType` is exactly that, else `context_injection`                                                                                                                  |
| Turn data toggles              | settings `includePreGenInjections` / `includeParallelResults` exactly `true`                                                                                                                         |
| Prompt                         | row `promptTemplate`, else empty (any falsy value)                                                                                                                                                   |

"Else" in this table means `null` or missing unless the row says otherwise;
stored values of other types (a string context size, say) are shown as stored.

**Built-in with no stored row**: name, description and author from the
built-in meta; status = its `enabledByDefault`; phase = its phase; no
connections; empty context size; max tokens and run interval from defaults
(else empty); no keywords, default scan depth; add-as-section =
defaults `injectAsSection === true`; tools = `DEFAULT_AGENT_TOOLS[id]` (else
none); writer off, no target; no sources; use chat-active =
defaults `useChatActiveLorebooks === true`; no files; avatars and backgrounds
off; reference images = `illustratorAvatarReferenceMode(defaults)`; empty image
tags; result type `context_injection`; turn data off; empty prompt.

**New custom agent**: name `New Agent`, everything else empty or off, status
on, phase Post-Processing, max tokens `DEFAULT_AGENT_MAX_TOKENS`, run interval
= the custom cadence default (below) or empty, default scan depth, reference
images `inherit`, result type `context_injection`, empty prompt.

The **custom cadence** (custom and new agents only) is
`getAgentRunIntervalMeta(type, false)` with `type` = `"__new__"` for a new
agent, else the row's `type` (else `agentDetailId`). The built-in cadence
(Illustrator only) is `getAgentRunIntervalMeta(builtInId)`.

## Header

One row: a back arrow button (`aria-label="Back to agents"`), a square icon
tile with the sparkles icon, the name input (placeholder `Agent name…`), then
on the right: the save status (`EditorSaveStatus` with unsaved, saving = an
update or create is running, saved flash, save error), **Delete** and
**Export** (custom agents with a stored row only), and **Save** (disabled while
an update or create is running). At phone width the right group wraps onto its
own row under a thin divider and the three buttons show only their icons.

- **Back**: with unsaved edits, shows the unsaved bar and stays; otherwise
  closes the editor (`closeAgentDetail`).
- **Delete**: asks with `showConfirmDialog({ title: "Delete Agent", message:
"Delete this custom agent? This cannot be undone.", confirmLabel: "Delete",
tone: "destructive" })`; on yes deletes the row by id, then closes. On no,
  nothing.
- **Export**: disabled while an export is running (spinner icon). Saves
  `JSON.stringify(buildAgentExportEnvelope(row), null, 2) + "\n"` (the
  **stored** row, not unsaved edits) with `saveTextFileToUserSelectedLocation({
filename: agentExportFilename(row), content, title: "Export Agent",
mimeType: "application/json", filters: [{ name: "JSON", extensions:
["json"] }] })`. Result `saved` → toast `Agent exported.`; `downloaded` →
  `Agent export downloaded.`; anything else → no toast; a throw → error toast
  `toUserMessage(error, { fallback: "Couldn't export agent. Try again." })`.

## Unsaved bar, error banner, knowledge warning

- The `UnsavedChangesBar` shows after Back with edits. **Keep editing** hides
  it; **Discard** closes the editor; **Save and close** saves and closes only
  if the save succeeded. It stays shown after a later successful Save from the
  header (see "Follow-ups").
- The `SaveErrorBanner` shows the save error; dismissing clears it.
- For Knowledge Router or Knowledge Retrieval (by `agentDetailId` or the row's
  `type`): when the agents list has an **enabled** row of type
  `knowledge-router` and one of type `knowledge-retrieval`, an amber line with
  an alert icon says `<the other one> is also configured. Both agents will run
before generation and may inject overlapping context. Consider disabling one
for cleaner prompts.` (`Knowledge Retrieval` on the router, `Knowledge
Router` on retrieval). "Enabled" is `agentEnabledFlag(row.enabled, true)`.

## Body

One centered column (max 48rem), groups top to bottom. Each group has a small
icon, a semibold label and a `HelpTooltip`. Every edit marks the form unsaved,
except leaving the max tokens box and deleting an uploaded file.
Visible text and help texts are in the recordings; use them verbatim.

"Agent type is X" below means `agentDetailId === X` **or** the stored row's
`type === X`. "Custom" means a custom or new custom agent.

1. **Description**: text input (`What does this agent do…`).
2. **Author**: text input (`Author name...`).
3. **Agent Status**: one toggle card: `Enabled` / `Disabled` with a one-line
   explanation.
4. **Pipeline Phase**: three buttons, Pre-Generation, Parallel,
   Post-Processing (one column at phone width, three from 640px), each with
   its icon and label; the chosen one is tinted in its own color (amber, sky,
   emerald). Under them, the chosen phase's description.
5. **Result Type** (custom): two cards, Context Injection and Text Rewrite,
   with a description each. Picking Text Rewrite also sets the phase to
   Post-Processing. With Text Rewrite chosen, an amber note shows the expected
   JSON shape.
6. **Turn Data Access** (custom, and the effective phase is Post-Processing,
   where effective = Post-Processing when Text Rewrite is chosen, else the
   chosen phase): two toggle cards, Pre-generation injections and Parallel
   agent results.
7. **Lorebook Writer** (custom): a toggle card (`Enabled` / `Disabled`), then
   a `Target lorebook` dropdown. The toggle is disabled (and does nothing)
   when the writer is off and the lorebook list has loaded empty. The dropdown
   is disabled while the writer is off, the list is loading or empty. Its first
   option is `Select a lorebook` (`Loading lorebooks...` while loading); when
   the chosen id isn't in the loaded list it adds `Missing lorebook (<id>)`;
   then each lorebook by name (`Untitled lorebook` when empty). Notes:
   `Create a lorebook before enabling writes for this agent.` (list loaded
   empty); amber `The saved target lorebook is no longer available. Select
another lorebook before saving.` (writer on and target missing).
8. **Connection Override**: dropdown; first option `Agent default (<name>)`
   when a non-image connection has `defaultForAgents` `true` or `"true"`, else
   `Use chat connection`; then every non-image connection as `<name>
(<provider>)`. A note under it.
9. **Image Generation Connection Override** (agent type is `illustrator`):
   dropdown with `Illustrator agent default (<name>)` (an image connection
   with `defaultForAgents`) or `None (no image generation)`, then image
   connections; a note; two text areas side by side from 768px, `Positive
prompt / tags` and `Negative prompt`, with their placeholders; a note; a
   `Character & persona references` dropdown (`Inherit chat setting`,
   `Always send`, `Never send` = `inherit`, `enabled`, `disabled`); a note.
10. **Auto-Generate NPC Avatars** (agent type is `character-tracker`): a
    checkbox `Generate avatar portraits for new NPCs`; when on, an `Image
Generation Connection` dropdown (`None (select a connection)`, then image
    connections). It edits the same image connection value as group 9.
11. **Background Image Generation** (agent type is `background`): a toggle
    card (`Generate when missing` / `Leave backgrounds unchanged`); when on, an
    `Image Generation Connection` dropdown (`Agent image default (<name>)` or
    `None (select a connection)`, then image connections), a note, and an
    amber warning when no image connection is chosen and there is no image
    default.
12. **Agent Budget**: `Context Size` (number, 1 to 200, placeholder
    `DEFAULT_AGENT_CONTEXT_SIZE`, unit `messages`) except for Chat Summary,
    which shows a note instead; `Max Output Tokens` (number, placeholder
    `DEFAULT_AGENT_MAX_TOKENS`, unit `tokens`); two notes (the first not for
    Chat Summary). Two columns from 640px.
13. **Custom cadence** (custom, when the custom cadence meta exists): label,
    help and unit from the meta; a text input with up/down buttons
    (`Increase trigger cadence`, `Decrease trigger cadence`).
14. **Activation Keywords** (custom): `Keywords` text area (4 rows, placeholder
    three lines `tavern`, `secret door`, `moonlit ritual`) and `Scan Depth`
    (number, 1 to the maximum, placeholder the default, unit `messages`); a
    note.
15. **Triggers After** (agent type is `chat-summary`): number 1 to 200,
    placeholder `5`, unit `user messages`, a note.
16. **Run Interval** (agent type is `lorebook-keeper`): number 1 to 100,
    placeholder `8`, unit `messages`, a note.
17. **Built-in cadence** (agent type is `illustrator` and there is built-in
    cadence meta): label/help/unit from the meta, number 1 to its max,
    placeholder its default, a note.
18. **Add as Prompt Section**: toggle card, `Enabled` with `"<name>" appears as
a section option in prompt presets` (the current name), or `Disabled` with
    `Agent output is not injected into prompts`.
19. **Knowledge Sources** (agent type is `knowledge-retrieval` or
    `knowledge-router`): see below.
20. **Prompt Template**: see below.
21. **Tools / Function Calling**: see below.
22. **About this Agent** card: `Type:` (`Custom` for a custom agent with a
    stored row, else `agentDetailId`), `Phase:` (`<label> — <description>` of
    the chosen phase), `Result Type:` (custom only), `DB Status:` (`Persisted
(ID: <row id>)` or `Not yet saved — click Save to persist`), and `Add this
agent to a Roleplay chat to use it.`

### Number inputs

Typing into a number input stores:

- Context size, Triggers After: empty when the box is empty, else the parsed
  integer clamped to 1..200 (unparseable → 1).
- Run Interval (Lorebook Keeper): same, 1..100.
- Built-in cadence: same, 1..its max.
- Scan depth: same, 1..the scan depth maximum.
- Max output tokens: empty when empty or unparseable, else the parsed integer
  clamped to 1..`MAX_AGENT_MAX_TOKENS`; leaving the box clamps a non-empty
  value to `MIN_AGENT_MAX_TOKENS`..`MAX_AGENT_MAX_TOKENS` (this doesn't mark
  the form unsaved).
- Custom cadence: the box shows `getCadenceInputValue(value)`, and while
  focused the raw value (`String(value)`, so empty shows as an empty string);
  focusing selects the text; typing stores
  `parseOptionalCadenceInputValue(text, max)`; Arrow Up/Down (default
  prevented) and the two buttons store `stepCadenceValue(value, ±1, max)`.

### Knowledge Sources

- A toggle card, `Use this chat's active lorebooks`, with `aria-pressed` and
  `aria-label="Use this chat's active lorebooks: on|off"`.
- `Lorebooks`: each lorebook as a selectable row (checkbox square, name,
  description when present) in a list capped at 12rem tall, or `No lorebooks
available.`. Clicking adds or removes it (in click order). With any selected:
  `Fixed selections override chat-active lorebooks for every chat that uses
this agent.`
- Router only, next to the `Lorebooks` label: a coverage badge over the
  selected lorebooks' entries, hidden while there is no selection or the
  entries are loading or failed: `No entries yet` (grey dot) when there are
  none, else `<n>% described (<with>/<total>)` where "described" means a
  non-blank description, with a dot that is emerald at 75% or more, amber at
  25% or more, else red. Router only, with a selection or chat-active on: the
  italic tip about descriptions.
- Retrieval only, `Files`: each uploaded knowledge source as a selectable row
  (name and size in KB with one decimal) with a trash button (`title="Delete
file"`) that deletes the source and, on success, unselects it (without
  marking unsaved); a hidden file
  input accepting `.txt,.md,.csv,.json,.xml,.html,.htm,.log,.yaml,.yml,.tsv,.pdf`
  and a dashed `Upload File` button (`Uploading...` with a spinner, disabled,
  while uploading). An upload adds the new source's id to the selection and
  marks unsaved; a failed upload does nothing more; the input is cleared after
  either so the same file can be picked again.
- With any lorebooks or files selected: `<n> lorebook(s), <n> file(s)
selected` (only the non-zero parts, singular for 1).

### Prompt Template

- Built-in meta present: a toolbar with a badge, `Using built-in default`
  (emerald) when the prompt is blank (after trimming) or `Custom override`
  (amber), and a button: `Reset to default` (clears the prompt) when
  overriding, or `Copy default to edit` (puts `getDefaultAgentPrompt(id)` in
  the prompt) when using the default and that default isn't empty. Both mark
  unsaved.
- Built-in and blank prompt: the default prompt shown read-only in a
  monospace box (`No default prompt.` when there is none), with the corner
  label `Default — click "Copy default to edit" to customize`.
- Otherwise a monospace text area (16 rows, placeholder `Write the system
prompt for this agent…`).
- A note: built-in → `Leave empty to use the built-in default prompt. Edit to
override with your own instructions.`; Text Rewrite → `Write the full system
prompt for this custom editor. It must return JSON with "editedText" and
"changes".`; else `Write the full system prompt for this custom agent.`

### Tools / Function Calling

An intro note, then one card per tool: every `BUILT_IN_TOOLS` entry except the
lorebook write tool (`LOREBOOK_WRITE_TOOL_NAME`), then every custom tool that
`isCustomToolSelectable(tool, capabilities)` accepts (marked `custom`, using
its name, description and parameter schema). Each card: a toggle button that
adds the tool's name to the end of the enabled list or removes it, and a
header button that expands the card to list its parameters (`name`, a red `*`
when required, the type, ` — <description>` when present, `[a, b]` for an
enum). A closing note about Chat Settings.

## Save

**Save** (header or the unsaved bar) does nothing without an `agentDetailId`.
It clears the save error, then:

1. Builds the writer state with `buildAgentLorebookWriterSaveState({
enabledTools, isEditingCustomAgent: custom, lorebookWriteEnabled,
writableLorebookId })`.
2. If the writer is on and there's no target: error `Select a target lorebook
before enabling lorebook writing for this agent.`, nothing sent. If the
   writer is on, the lorebook list has loaded and doesn't contain the target:
   `Select an available target lorebook before enabling lorebook writing for
this agent.`, nothing sent.
3. Sends this payload (keys in this order; `…` entries only when their
   condition holds):

| Key              | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| `name`           | the name as typed                                                   |
| `description`    | as typed                                                            |
| `credit`         | `agentCreditLabel(author)` (trimmed)                                |
| `phase`          | Post-Processing when custom and Text Rewrite, else the chosen phase |
| `enabled`        | the status                                                          |
| `connectionId`   | the chosen connection, or `null` when empty                         |
| `promptTemplate` | the prompt as typed (not trimmed)                                   |
| `settings`       | the object below                                                    |

Settings, in this order:

| Key                                         | When                                                      | Value                                                                         |
| ------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `resultType`                                | custom                                                    | the result type                                                               |
| `activationKeywords`, `activationScanDepth` | custom and the normalised keywords aren't empty           | the normalised keywords; the scan depth (default when empty, else normalised) |
| `includePreGenInjections`                   | custom, saved phase Post-Processing, toggle on            | `true`                                                                        |
| `includeParallelResults`                    | same, toggle on                                           | `true`                                                                        |
| `contextSize`                               | not empty                                                 | `Number(value)`                                                               |
| `maxTokens`                                 | not empty                                                 | clamped to `MIN`..`MAX_AGENT_MAX_TOKENS` and truncated                        |
| `runInterval`                               | not empty                                                 | `Number(value)`                                                               |
| `injectAsSection`                           | on                                                        | `true`                                                                        |
| `enabledTools`                              | always                                                    | the writer state's enabled tools                                              |
| (writer settings)                           | always                                                    | the writer state's `writerSettings`, spread                                   |
| `useChatActiveLorebooks`                    | agent type is `knowledge-retrieval` or `knowledge-router` | the toggle                                                                    |
| `sourceLorebookIds`                         | any selected                                              | the selection                                                                 |
| `sourceFileIds`                             | agent type is `knowledge-retrieval` and any selected      | the selection                                                                 |
| `imageConnectionId`                         | not empty                                                 | the image connection                                                          |
| `autoGenerateAvatars`                       | on                                                        | `true`                                                                        |
| `autoGenerateBackgrounds`                   | on                                                        | `true`                                                                        |
| (reference image settings)                  | agent type is `illustrator`                               | `serializeIllustratorAvatarReferenceSettings(mode)`, spread                   |
| `imagePositivePrompt`                       | not blank                                                 | trimmed                                                                       |
| `imageNegativePrompt`                       | not blank                                                 | trimmed                                                                       |

Note: the form fills the keyword text from stored settings for every stored
row, built-ins included, but only a custom agent's keywords are sent: a
built-in with stored keywords saves without them (and so drops them).

4. With a stored row: update the row by its `id` with the payload. Without one:
   create with the payload plus `type` = the built-in id for a built-in, else
   `createCustomAgentType(name)`. After creating a custom agent that came back
   with an `id`, open it (`openAgentDetail(id)`), so the editor now edits the
   stored row.
5. On success: unsaved cleared, `Saved` flash for 1.5 seconds. On failure: the
   save error is `toUserMessage(error, { fallback: "Couldn't save agent config.
Try again." })` and the unsaved state stays. Returns whether it saved (for
   Save and close).

The unsaved state is mirrored to the UI store (`setEditorDirty`) whenever it
changes.

### Recorded details

The recordings are the source of truth for these (found while recording the
old editor; keep them):

- **Stored shape.** The tables above are what the editor hands the hooks. The
  hooks' schema then fixes the stored key order and fills defaults (on create:
  `type, name, description, credit, imagePath: null, phase, enabled,
connectionId, promptTemplate, settings`; inside `settings` the activation
  keys come first, then `resultType`). Hand the hooks the same values; the
  recordings show what storage receives.
- **Schema rejections.** An empty name, a name over 200 characters and other
  values the schema rejects send nothing; the banner shows the generic
  `Couldn't save agent config. Try again.`
- **Odd stored values** save as recorded: `maxTokens: "abc"` saves `NaN`; a row
  without `description` hands `description: undefined`; a numeric `credit`
  shows as `5` and saves `""`; a built-in row with a `null` credit saves the
  built-in's credit; a stored `save_lorebook_entry` tool is dropped on save;
  stored source lorebook or file ids that no longer exist still count in the
  "selected" summary and are saved as they are.
- **A held save.** Edits typed while a save is running are lost when it
  succeeds (the refetched row refills the form).
- **Saved flash.** Every Save starts its own 1.5-second timer and none is
  cancelled, so an earlier timer can end a later flash early.
- **Number boxes.** A browser number box hands an empty string for text it
  can't read (`abc`), so the value becomes empty; only text `parseInt` reads
  oddly (`1e3`, `2.9`) gives the clamped integer.
- **Whitespace prompt.** On a built-in, a prompt of only whitespace counts as
  blank, so the read-only default replaces the text area while typing.
- **Duplicate matches.** When one row matches by `type` and another by `id`,
  the first in list order wins.
- **Export throws before saving** (no toast, an unhandled rejection) when the
  export envelope can't be built: a type that isn't `custom-…`, a built-in
  opened by its row id, or a row the schema rejects. Only throws from the file
  save give the error toast.
- **Delete** with unsaved edits closes without the unsaved bar; a failed
  Delete is an unhandled rejection and the editor stays open.
- **Uploads and file deletes.** A failed upload shows nothing. A failed file
  delete shows the hooks' generic toast. Picking another file while an upload
  is running still changes the selection.
- **Coverage dot** compares the unrounded share (75% or more emerald, 25% or
  more amber), so 74.5% shows `75% described` with an amber dot. An entry whose
  description isn't a string crashes the coverage count.
- **Max tokens blur** clamps and truncates (`1500.7` becomes `1500`).
- **Connection** fills with the stored value unless it is `null` or missing
  (`0` and `false` show as stored). After creating, any truthy returned id is
  opened.
- **Budget note** prints `DEFAULT_AGENT_MAX_TOKENS` with `toLocaleString()`.
- **Custom tool schemas.** A selectable custom tool with `parametersSchema:
null` crashes the whole editor; an `enum` that isn't an array crashes when
  its card is expanded; a `required` that is a string marks parameters by
  substring; a schema stored as a JSON string shows no parameters.

## Layout

Use the screenshots (old build, real Chrome, every agent type at 1366 and 660
wide, dark and light). Checked against them:

- **Breakpoints.** Below 768px the header's right group wraps onto its own row
  under a thin divider, the three header buttons show only their icons, the
  icon tile is 2rem (else 2.5rem), the name is 1rem (else 1.125rem), header
  padding is 0.75rem across (else 1rem) and body padding 1rem (else 1.5rem).
  The pick grids (phases, result types, turn data) and the budget columns go
  from one column to several at 640px; the Illustrator tag boxes sit side by
  side from 768px.
- **Header buttons.** Delete is destructive-colored text with a trash icon.
  Export is a pill (secondary background, a ring, 1rem side padding, a small
  shadow) with the **Upload** icon (arrow up out of a tray); while exporting it
  shows a spinner, a wait cursor and 70% opacity. Save has the primary
  background with a shadow. 0.75rem text, 0.8125rem icons.
- **Knowledge warning** is a full-width strip between the error banner and the
  scrolling body (it doesn't scroll): amber 400 text on a 10% amber
  background, `AlertCircle` icon, 0.75rem text.
- **Group headers**: icon (0.875rem, primary color unless noted), semibold
  0.75rem label, help icon; 0.5rem between header and content. Icons:
  Description `Info`, Author `Sparkles`, Agent Status `Sparkles`, Pipeline
  Phase `Zap`, Result Type `FileText`, Turn Data Access `Layers`, Lorebook
  Writer `BookOpen`, Connection Override `Link2`, Image Generation Connection
  Override `ImageIcon`, Auto-Generate NPC Avatars `Sparkles`, Background Image
  Generation `ImageIcon`, Agent Budget `Clock`, both cadences, Triggers After
  and Run Interval `Clock`, Activation Keywords `Activity`, Add as Prompt
  Section `Layers`, Knowledge Sources `BookOpen` in amber 400, Prompt Template
  `FileText`, Tools `Wrench`.
- **Toggle cards** (Agent Status, Turn Data Access, Lorebook Writer): full
  width, 0.75rem corners, a 1px ring, 0.75rem padding, `ToggleRight` (emerald 400) when on / `ToggleLeft` when off at 1rem, a semibold title and a
  0.625rem tight line under it. On: primary 10% background, full primary ring,
  foreground text; off: muted text, border ring, accent on hover. No pill
  switches.
- **Add as Prompt Section** is a content-width button (secondary background,
  ring, 1rem by 0.75rem padding) with a 1.25rem toggle icon (emerald 400 on),
  a 0.875rem medium title and a 0.625rem muted line. **Background Image
  Generation** is the same but full width.
- **Phase buttons**: icon (1rem) **above** the medium label, centered, 0.75rem
  padding; icons Pre-Generation `Zap`, Parallel `Activity`, Post-Processing
  `Clock`. Chosen: primary 10% background and primary ring, text and icon in
  the phase color (amber 400, sky 400, emerald 400). Others: muted text, border
  ring.
- **Result type cards**: semibold label over a 0.625rem tight description,
  left-aligned. The Text Rewrite note is an amber box (amber 400 at 20% border,
  10% background, amber 200 text, 0.625rem, 0.5rem corners) with the JSON in a
  small dark code chip.
- **Number boxes** (secondary background, ring): Context Size, Scan Depth,
  Triggers After, Run Interval and the cadence boxes are 7rem wide, Max Output
  Tokens 8rem; the unit beside them is 0.6875rem muted with a 0.75rem gap. The
  custom cadence's up/down chevrons sit **inside** the right end of its 7rem
  box, stacked. Labels above number boxes are 0.6875rem medium muted.
- **Chat Summary budget note** is a box (accent 50% background, a ring,
  0.75rem corners, 0.6875rem muted text).
- **Illustrator tag boxes**: 0.75rem text, a 1px border (not a ring), 0.75rem
  corners, secondary background, at least 5rem tall, placeholder at 45%; the
  border turns primary on focus. The NPC checkbox label is 0.875rem.
- **Knowledge Sources**: the chat-active toggle uses a 1px border and 0.5rem
  corners and is **amber** when on (amber 500 at 30% border, 10% background,
  amber 200 text), with a 1.25rem toggle icon. Lorebook rows and file rows sit
  in lists capped at 12rem tall that scroll; each row has a 1rem square
  checkbox (with a check icon when selected) and, when selected, amber styling
  (amber 500 at 10% background and 20% border, amber 300 text). Lorebook name
  medium and truncated, description 0.625rem muted truncated below. Files:
  white-alpha list (10% border, 2% background), name truncated and the size
  under it (0.625rem, 40% white), trash 20% white turning red on hover; the
  `Files` label is 60% white, the dashed upload button 15% white border and
  50% white text (amber on hover), the summary 40% white. Coverage dots are
  0.375rem, emerald/amber/red 400, the grey one at 50% opacity.
- **Prompt Template**: badges 0.5rem corners (`Check` icon for default,
  `FileText` for override); `Reset to default` with `RotateCcw`, `Copy default
to edit` with `FileText`. The default box is monospace 0.75rem relaxed, 1rem
  by 0.75rem padding, at most half the screen tall, resizable, with the corner
  label as a small chip (card background, ring) at the top right. The text area
  is at most 60% of the screen tall.
- **Tool cards**: 0.75rem corners, a ring (primary 50% and primary 5%
  background when on); a toggle icon button (`ToggleRight` primary /
  `ToggleLeft` muted, 1.25rem), then a 1.5rem square tile with a `Wrench`
  (primary 15% background for custom tools, muted for built-in), the name in
  semibold monospace 0.75rem with the small `custom` tag, the description on
  one truncated line, and ▲/▼ at the right.
- **About card**: no icon; the labels (`Type:`, `Phase:`…) are bold foreground.
- Notes use the normal line height. Everything else uses the theme tokens.

## Decisions

The rebuild keeps every stored payload, every visible text, every shown value
and every enabled/disabled state exactly as recorded, except these
accessibility changes (no stored value or visible text changes):

1. **Toggles don't announce their state.** Recommended: `aria-pressed` on every
   on/off or pick-one button: Agent Status, the three phases, the two result
   types, the two turn data toggles, the lorebook writer toggle, Background
   Image Generation, Add as Prompt Section, each tool's toggle, each lorebook
   and file row. (The chat-active toggle already has it.)
2. **Unnamed controls.** Recommended: `aria-label="Agent name"` on the header
   name input; each tool card's toggle `aria-label="<tool name>"` (with
   `aria-pressed`) and its expand button `aria-expanded`; the file trash
   button `aria-label="Delete file"` (it already has that `title`); labels tied
   to their inputs for the number boxes, dropdowns and text areas that have a
   visible label above them.
3. **Buttons default to submit.** Recommended: `type="button"` on every button.
4. **Small accessibility details** (no visible change): header button labels
   hidden visually but kept for screen readers below 768px, decorative icons
   `aria-hidden`.

## Follow-ups after the rebuild

Not in this rebuild (it keeps them as recorded); each is its own small pull
request after it:

1. A connections list that changes (another tab or a refetch with new data)
   refills the form and throws away unsaved edits, and so does any change to
   the stored row.
2. Stored `settings` that is a string but not valid JSON, or a stored `phase`
   that isn't one of the three, crashes the editor.
3. The unsaved bar stays after a successful Save from the header (like the
   tool editor's old bar).
4. A failed Delete says nothing and the editor stays open; a failed upload or
   file delete only shows whatever the hooks show.
5. A built-in opened by its row `id` instead of its type is treated as a custom
   agent (Delete, Export, Result Type and the custom groups show, and Save
   forces the custom settings).
6. The Files list uses white-alpha colors that are hard to read in the light
   theme.
7. The phase description under the phase buttons and in the About card shows
   the chosen phase even when Text Rewrite will save Post-Processing.
8. `EditAgentModal.tsx` (172 of 184 lines not team-owned) looks like an older
   editor for the same rows; check whether it is still used.
9. A custom tool with a `null` or odd parameter schema crashes the editor for
   every agent (see "Recorded details"); treat a bad schema as no parameters.
10. Export of an agent whose envelope can't be built and a failed Delete fail
    silently; show an error instead.
11. Edits typed during a held save are lost; a failed upload shows nothing.
12. The schema's name rule (1 to 200 characters) shows only the generic error;
    say what is wrong.

## Tests

The new module's tests use the recordings:

- For every recorded starting state: every field's shown value, which groups
  and options show, the badges and notes, the save status, the header buttons'
  presence and disabled state and the visible text match the recording.
- For every recorded action sequence: the visible state after each step, every
  storage and knowledge call (with the exact payload), every confirm dialog,
  file save and toast, and the store state after each step (`agentDetailId`,
  `editorDirty`) match the recording, except where decisions 1 to 3 add
  attributes.
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with throwaway agents, at 1366x900 and 660x900:
  the recorded step lists give the same stored rows and the same visible states
  as the old build (except the decisions), and the screenshots match the old
  ones by eye (dark and light).
- The live install's stored agent rows, read read-only and replayed offline:
  every stored row opens with identical fields in the old and new editor, and
  opening then saving without edits sends identical payloads.
- `AgentEditor.tsx` is gone and nothing imports it.

## Black-box recording plan

Recorded by someone other than the builder, on `main` before the old file is
deleted, with no real data and no model calls (this screen makes none). Saved
under `src/features/catalog/agents/components/agent-editor/test-fixtures/` as
one-line JSON (listed in `.prettierignore`), each file under about 1 MB.

1. **Component recordings**: the old editor rendered in the test environment as
   a black box: a fake storage behind the agents, lorebooks, lorebook entries,
   connections, custom tools and knowledge source hooks (list, create, update,
   delete, upload; each can be told to fail or to hold), the real UI store, the
   confirm dialog answered by the recorder, the file save and toasts captured.
   Starting states: `__new__`, a missing id, no id, an empty list, every
   built-in with no row, every built-in with a stored row, custom rows covering
   every field (settings as an object, as a JSON string, `null`; legacy and odd
   values: `enabled` `"false"`/`0`, `useChatActiveLorebooks` `"yes"`/`"off"`,
   string numbers, keywords as text and as an array, a missing target lorebook,
   writer tools, unknown custom tool names, Text Rewrite, turn data flags, every
   image setting), both knowledge agents enabled and one disabled, connections
   with and without agent defaults (`true` and `"true"`), lorebooks with and
   without descriptions and entries, knowledge sources. For each: the shown
   state, then action sequences (typing in every field and number box, out of
   range and blank numbers, max tokens blur, cadence arrows and buttons, every
   toggle and dropdown, phase and result type switches, writer on/off with and
   without lorebooks, source and file selection order, upload success and
   failure, file delete, prompt copy default and reset, tool toggles and
   expand, Save success, failure and held, both writer validation messages,
   create of a built-in and of a custom agent, Back with and without edits and
   each unsaved-bar button, opening another agent with edits, a list refresh
   with and without a changed row, a connections change with edits, Delete with
   cancel and confirm, Export with each result and a throw), recording after
   each step the shown state, every call made and the store state.
2. **Real Chrome**, headless Chrome with a local server and throwaway agents:
   a subset of the same step lists through the real Agents panel at 1366x900
   and 660x900 in dark and light, recording the stored row after each save;
   plus screenshots of every agent type for the builder.

The builder gets the recordings, the screenshots and this spec.
