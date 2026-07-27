# Memory Maintenance Design

## Goal

Make memory maintenance understandable and safe:

- **Tidy memories** uses AI to propose consolidating repetitive or unnecessarily verbose memories.
- **Repair from chat history** deterministically recreates automatic chat-local transcript memories from saved messages.
- AI cleanup never changes memory until the user reviews a before-and-after preview and presses **Apply cleanup**.
- Cleanup is reversible and never silently changes protected or out-of-scope memories.

This design preserves the existing distinction between chat-local transcript
memory and character-wide canonical memory. It does not add global cleanup,
automatic background rewriting, or cross-scope consolidation.

## Current Behavior and Problem

The Memory Console currently exposes an icon-only circular-arrow action titled
`Rebuild memories`. The action refreshes automatic transcript-owned rows from
saved chat messages, reuses current embeddings when possible, and removes some
obsolete overlapping automatic captures. It is a deterministic repair path, not
an AI summarizer.

The label and icon do not communicate that behavior. A circular arrow resembles
ordinary list refresh, while "rebuild" does not tell the user what is rebuilt,
what may change, or whether AI is involved.

The console also combines two owners:

- editable memory local to the current chat or scene; and
- read-only character-wide canonical memory inherited into the chat.

A maintenance action must not blur that ownership boundary.

## Product Design

### Primary action: Tidy memories

Add a visible, labeled **Tidy memories** action with a wand icon:

- in the chat Memory Console, it acts only on editable local memories;
- in Character Editor > Memories, it acts only on that character's canonical
  memories;
- inherited character memories remain read-only in the chat console and link to
  the owning character tab.

Activating the action opens a cleanup review flow. Analysis performs no writes.
The initial summary uses concrete language, for example:

> 24 memories → 13 memories
> 7 repetitive groups can be combined. Pinned and manually written memories
> will stay unchanged.

The review lists each proposed change with:

- the existing memories involved;
- the proposed replacement or retained winner;
- the reason, such as `Repeated fact`, `Overlapping detail`, or
  `Shorter wording`;
- the expected memory-count and approximate token reduction;
- a selected-by-default checkbox for safe proposals;
- an editable replacement field for proposals that create new text.

Conflicts are listed separately and are not selected. Cleanup never chooses
which contradictory statement is true. The user can leave the cleanup flow and
use the existing correction or edit controls.

**Apply cleanup** applies only selected proposals. The completion state reports
the exact number combined, shortened, skipped, and left unchanged, and offers
**Undo cleanup**.

### Advanced action: Repair from chat history

Remove the current circular-arrow action from the primary toolbar. Preserve its
capability in the Memory Console's advanced `…` menu as:

**Repair from chat history**

Its description is:

> Recreate automatic transcript memories from this chat's saved messages and
> remove obsolete overlapping automatic captures. This does not summarize
> memories or use AI. Manually written, imported, edited, pinned, command, and
> character-wide memories are left alone.

The confirmation action is **Repair memories**. Completion reports how many
automatic memories were rebuilt or reused. This operation remains available
without a configured text-generation connection.

This is distinct from a passive query refresh. React Query invalidation
continues to refresh the visible list after mutations; the product does not add
another user-facing "refresh list" action.

## Cleanup Eligibility and Protection

Cleanup analyzes active memory in one explicit owner scope. It does not include
deleted, wrong, stale, or superseded history as source material.

The following records are protected and cannot be rewritten or superseded by an
automatically selected proposal:

- pinned memory;
- manually created or user-edited memory;
- correction records and their inactive history;
- command/tool-owned memory;
- imported memory;
- memory outside the selected chat, scene, or character scope.

Protected active records may serve as a retained winner. For example, when an
automatic transcript memory repeats a pinned manual memory, cleanup may propose
superseding only the automatic duplicate while leaving the protected record
unchanged.

The first version tidies automatic memory only. Users continue to manage
protected records with existing edit, correction, pin, delete, import, and
export controls.

## Proposal Types

The cleanup analyzer may return:

1. **Keep one**: retain the strongest existing memory and supersede redundant
   eligible automatic rows.
2. **Combine**: create one concise replacement from two or more overlapping
   eligible automatic rows and supersede the sources.
3. **Shorten**: create a shorter equivalent replacement for one unnecessarily
   verbose eligible automatic row and supersede the source.
4. **Conflict**: report potentially contradictory memories without selecting or
   mutating either one.

Cleanup must not combine merely related memories. Distinct facts, events, time
periods, promises, preferences, or relationship changes remain separate even
when they concern the same subject.

## Architecture and Ownership

### React feature owners

- `MemoryRecallMemoriesModal` owns the chat-local entry point, preview UI, scope
  explanation, apply feedback, and the advanced repair menu.
- `CharacterMemoriesTab` owns the character entry point and character-scope
  preview.
- Shared presentation components may render proposal groups, reduction totals,
  protected-state explanations, stale-preview errors, and undo feedback.
- Feature code calls focused shared APIs or React-free engine services. It does
  not call raw Tauri commands or remote-runtime endpoints.

### React-free cleanup engine

A focused memory-maintenance service owns:

- eligibility and protected-record classification;
- bounded candidate grouping;
- LLM request and strict response parsing;
- proposal validation;
- reduction estimates;
- immutable preview construction.

For chat cleanup, model resolution uses the chat's effective text-generation
connection. For character cleanup, it uses the same default text-connection
resolution as character-field wand actions. If no usable connection exists,
the UI explains that AI cleanup needs a text connection; deterministic repair
remains available.

The analyzer sends only the selected scope's bounded memory records and the
minimum metadata needed to preserve meaning: stable ID, content, kind/status,
confidence, timestamps, and provenance identifiers. It never sends the full
chat transcript merely because cleanup was requested.

Candidate grouping first uses deterministic signals:

- normalized exact equality;
- shared message provenance;
- lexical overlap;
- available embedding similarity;
- unusually verbose automatic rows eligible for shortening.

The LLM evaluates bounded candidate groups rather than receiving every memory
in one unbounded prompt. Large scopes may use multiple groups and report
progress. Records without a credible duplicate, overlap, or verbosity signal
are not sent for rewriting.

### Preview contract

The analysis result is an immutable, non-durable preview containing:

- scope kind and ID;
- generated proposal IDs and proposal types;
- source memory IDs;
- a content/status/update fingerprint for every source and retained winner;
- proposed content and kind where applicable;
- source provenance union;
- human-readable reason;
- count and token estimates;
- protected and conflict summaries.

The frontend may edit proposed replacement text and deselect proposals, but it
cannot add source IDs or change scope.

### Privileged apply and undo

Apply and undo are host-owned storage operations available through both
embedded Tauri and hostable HTTP dispatch.

Before applying, the host verifies:

- every referenced memory still exists in the declared scope;
- its content, status, and update fingerprint still match the preview;
- every mutated source remains eligible and unprotected;
- replacement content is non-empty and within the memory contract;
- one source is not consumed by more than one selected proposal.

If any selected proposal is stale or invalid, the whole selected batch fails
without writes and the UI asks the user to analyze again.

Apply writes the selected batch atomically:

- **Keep one** preserves the winner and marks only redundant eligible sources
  superseded by that winner.
- **Combine** and **Shorten** create a replacement memory, union safe source
  provenance, and mark eligible sources superseded by the replacement.
- chat-local replacements use the existing chat-memory embedding owner;
- canonical character replacements use canonical-memory storage and index
  ownership;
- every created/relinked row records one cleanup batch ID.

No source is hard-deleted. Existing supersession fields remove old rows from
recall while preserving history.

Undo uses the cleanup batch ID to restore exactly the sources changed by that
batch and inactivate its generated replacements. Undo is also atomic and
refuses to overwrite later edits or later cleanup batches. Export and normal
backup behavior continue to preserve the resulting lifecycle history according
to their existing contracts.

## AI Safety and Validation

The cleanup prompt requires strict JSON and instructs the model to:

- preserve every supported fact, qualifier, time reference, relationship, and
  attribution;
- avoid inventing bridging details;
- distinguish duplication from contradiction;
- cite only supplied source memory IDs;
- prefer no proposal when equivalence is uncertain.

Deterministic validation rejects:

- unknown, repeated, protected, inactive, or cross-scope source IDs;
- a source consumed by multiple proposals;
- empty or oversized replacement text;
- invented provenance;
- unsupported proposal types;
- merge/shorten output without adequate lexical or provenance support;
- model output that attempts to resolve a conflict.

Invalid proposals are omitted from the preview and counted as skipped. A wholly
invalid response fails analysis with no writes.

Memory content is untrusted input. Delimiters and structured fields separate it
from instructions, and content that resembles prompt instructions receives no
special authority.

## Error Handling

- Analysis failure leaves memory unchanged and keeps the console usable.
- Cancellation stops outstanding analysis and performs no cleanup writes.
- A missing model connection blocks only AI cleanup, not deterministic repair.
- Partial model-group failure produces no applyable preview unless every
  proposal included in the displayed totals has been validated.
- A stale preview applies nothing and directs the user to rerun analysis.
- Apply/index failure reports failure and commits no partial cleanup batch.
- Undo failure leaves the applied cleanup intact and reports why it could not be
  safely reversed.
- Switching chats or characters invalidates the open preview so results cannot
  be applied to a different owner.

## User-Facing Copy

Primary action:

- `Tidy memories`
- Helper: `Find repeated or overly wordy automatic memories. You review every change before anything is saved.`

Review actions:

- `Analyze memories`
- `Apply cleanup`
- `Undo cleanup`
- `Analyze again`

Protected notice:

- `Pinned, manually written, edited, imported, corrected, and tool-created memories will not be rewritten.`

No-op result:

- `These memories already look tidy. Nothing needs to change.`

Stale result:

- `Some memories changed after this preview was created. Nothing was applied. Analyze again to review the latest version.`

Advanced repair:

- `Repair from chat history`
- `Recreate automatic transcript memories from saved messages. This does not summarize them or use AI.`

## Verification

### Pure engine tests

- eligibility classification protects every protected type and excludes
  inactive and cross-scope rows;
- deterministic candidate grouping finds exact, provenance-overlap, lexical,
  embedding, and verbose candidates without grouping merely related facts;
- strict parsing rejects invented IDs, overlapping proposals, conflicts posed
  as merges, and unsupported replacement content;
- bounded analysis never sends full chat transcripts or unrelated memory;
- model connection resolution matches chat and character wand rules.

### Storage and runtime tests

- chat apply creates indexed replacements and supersedes sources atomically;
- canonical apply updates canonical records and index rows atomically;
- protected or stale sources reject the whole batch;
- provenance union preserves source chat/message attribution without invention;
- undo restores exactly one untouched cleanup batch and rejects later-edited
  rows;
- embedded and remote runtime paths share the same validation and result
  contract;
- deterministic repair retains its current preservation rules and requires no
  LLM.

### UI tests

- the circular-arrow rebuild control is no longer a primary toolbar action;
- **Tidy memories** is labeled and opens a write-free preview;
- chat cleanup excludes inherited character memory and links to the character
  owner;
- proposal selection, replacement editing, totals, conflicts, protected notice,
  apply, stale-preview handling, and undo render truthful states;
- switching owner scope invalidates the preview;
- advanced repair copy explicitly distinguishes repair from AI cleanup.

### Manual proof and checks

Exercise both memory owners in a rendered app:

1. preview and cancel a cleanup, proving no stored rows change;
2. apply and undo a mix of keep-one, combine, and shorten proposals;
3. prove pinned/manual memory remains unchanged;
4. prove inherited character memory cannot be changed from the chat console;
5. run deterministic repair without a configured AI connection;
6. inspect network/runtime behavior for embedded and remote modes.

Implementation validation includes focused TypeScript and Rust tests,
`pnpm typecheck`, `pnpm check:architecture`,
`cargo check --manifest-path src-tauri/Cargo.toml`, `pnpm build`, and the full
`pnpm check` shipping gate.

The production merge build with `main` at `070a42382` measured 179.3 KiB
startup JS, 1702.5 KiB total JS, 268.0 KiB for the largest lazy route, and
79.0 KiB CSS after the cleanup hook's unconsumed result state was removed. The
shared cleanup review chunk is 7.2 KiB gzip. The total-JS guard therefore moves
from 1700 to 1710 KiB with measured evidence in this PR; the startup, largest
lazy-route, and CSS guards remain unchanged. The executable limit lives in
`scripts/check-bundle-budgets.mjs`; future budget changes must update this
measurement and that script together.

## Out of Scope

- automatic scheduled cleanup;
- cleanup across every chat or character at once;
- rewriting manually curated or pinned memory;
- deciding which contradictory memory is true;
- changing recall ranking, context budgets, summary generation, or embedding
  provider selection;
- replacing source transcript storage with AI summaries;
- hard-deleting superseded history;
- merging chat-local and character-wide memory into one owner.
