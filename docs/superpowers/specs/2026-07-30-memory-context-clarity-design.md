# Memory Context Clarity Design

## Goal

Make every automatically created De-Koi memory understandable without the
conversation that produced it.

The corrected behavior must:

- use the active persona name for the user when one is known;
- use the canonical `{{user}}` identity token when no persona name is known,
  never the literal proper name `User`;
- identify characters by name instead of relying on context-free pronouns;
- replace dangling references such as `it`, `this`, or `that` with the actual
  subject when the saved conversation supports that resolution;
- repair existing automatic memories from their original evidence when
  possible;
- discard an existing automatic memory when it is context-dependent and its
  original evidence cannot support a safe repair; and
- never invent missing people, subjects, events, or relationships.

This design applies to automatic Memory Recall capture and automatic hygiene.
It does not make Deki, the Memory Console, or manual memory editing responsible
for normal memory quality.

## Current Failure Boundary

Automatic consequence extraction in
`src/engine/generation/automatic-memory-capture.ts` currently renders saved
messages with generic role labels. Although each message retains a
`characterId`, the extraction prompt does not receive a resolved persona label,
a character-name roster, or earlier reference context. A model can therefore
produce content such as `He said...`, preserve an unresolved `it`, or treat
`User` as a person's name.

The raw transcript capture owner in
`src-tauri/src/commands/storage/chat_memory.rs` already resolves configured
persona and character names, but falls back to the literal label `User` when no
chat persona is configured.

Automatic memory hygiene can discard, retain, or combine records, but it has no
single-source clarification operation. A repairable vague memory therefore
cannot currently be replaced while preserving its history.

## Considered Approaches

### Prompt-only prevention

Add standalone-writing instructions to the extraction prompt.

This is inexpensive and improves new output, but it cannot reliably resolve
references outside the saved user/assistant pair and does not repair existing
records.

### Text-only rewriting

Ask a model to rewrite vague memories from their stored content alone.

This reaches old records, but it gives the model no trustworthy way to know who
`he` was or what `it` referred to. It can turn missing context into invented
canon.

### Provenance-backed capture and clarification

Give new extraction a bounded named context window. For existing automatic
memories, reload their provenance messages and nearby context before proposing
a replacement. Discard an irreparable context-dependent record rather than
guessing.

This requires a focused extension to the capture and maintenance contracts, but
it is the only approach that prevents new vague memories, repairs supported old
ones, and preserves epistemic safety.

## Decision

Use provenance-backed capture and clarification.

## Standalone Memory Contract

An automatic memory is standalone when a reader can understand the durable fact
without seeing the source conversation.

Accepted content must follow these rules:

1. The person acting as the user is named with the snapshotted persona name. If
   no name is available, use `{{user}}`.
2. A character is named before a pronoun can refer to that character. Starting
   a memory with an unexplained `he`, `she`, `they`, or similar reference is not
   valid.
3. Demonstratives and object pronouns such as `it`, `this`, `that`, or `there`
   must have an explicit referent in the same memory when the referent matters
   to the durable claim.
4. `User` and possessive forms such as `User's` are not valid identity labels.
5. A memory remains compact. Reference resolution adds only the minimum wording
   needed to make the durable fact self-contained.
6. A repair preserves the original supported meaning, certainty, attribution,
   scope, and memory kind. Clarification cannot introduce a new event or infer
   an unstated motive.

Pronouns are not banned. `Pierrot told Celia that he would return` is
self-contained because the named antecedent is present. `He said he would
return` is not.

## Capture Context

### Named source snapshots

The automatic capture job stores a bounded identity snapshot alongside its
message snapshots:

- `userLabel`: the chat persona's trimmed display name, or `{{user}}`;
- `characterLabels`: known chat character IDs mapped to trimmed display names;
- each message's resolved `speakerLabel`; and
- the existing role and stable character ID.

Identity is snapshotted when the capture job is enqueued so a retry cannot
silently change attribution after a persona or character is renamed.

### Bounded reference window

Each new capture contains at most eight visible saved messages:

- the user/assistant exchange that triggered capture; and
- up to six immediately preceding visible messages from the same chat.

Hidden-from-AI messages, empty messages, tool-only internals, and messages from
another chat are excluded. The current exchange remains the evidence boundary;
older messages exist only to resolve names and references.

Every snapshotted message participates in the existing stale-source check. If a
message is edited, deleted, moved, or reattributed before processing, the job is
marked stale instead of creating memory from outdated context.

### Evidence and reference IDs

An extracted candidate continues to return `sourceMessageIds` for messages that
prove the durable claim. It may additionally return `referenceMessageIds` for
supplied context used only to resolve an identity or antecedent.

Validation enforces:

- every ID was supplied in the capture request;
- evidence rules use only `sourceMessageIds`;
- textual support may use the union of source and reference messages;
- reference messages cannot turn an unsupported inference into canon; and
- persisted provenance contains the stable de-duplicated union of both ID
  lists.

This keeps direct-user-assertion and explicit-event rules intact while allowing
`it` to be replaced with a subject established in a nearby message.

## New-Memory Extraction

The consequence extraction prompt renders each message with its stable ID,
role, resolved speaker label, and content. It also provides the bounded roster
of known identities and explicitly separates the current evidence exchange
from reference-only context.

The prompt requires standalone content and gives concrete negative/positive
examples covering:

- `User's cat is Miso` -> `Celia's cat is Miso` or `{{user}}'s cat is Miso`;
- `He promised to return` -> `Pierrot promised Celia he would return`; and
- `Pierrot does not want to discuss it` -> `Pierrot does not want to discuss
the circus accident`.

The parser rejects malformed IDs, invalid kinds, unsupported evidence, and
obvious standalone-contract failures. The shared pre-storage value review also
treats unresolved or context-dependent wording as low-value, so a failed
extraction is rejected rather than saved for later cleanup.

The deterministic check is deliberately narrow. It catches guaranteed failures
such as a literal `User` identity and an unexplained opening pronoun; it does not
pretend that a regular expression can resolve natural-language coreference.

## Existing-Memory Repair

### Eligibility

The clarity pass targets active or pinned canonical memories whose lineage is
model-created:

- automatic capture records;
- legacy automatic canonical episodes; and
- cleanup-created replacements whose source lineage is automatic.

Manual, imported, corrected, command-created, tool-created, or explicitly
user-edited content is not automatically rewritten or discarded by this
clarity pass. Existing general hygiene policy remains separate.

A cheap reference-risk detector selects possible clarity candidates. Detection
only authorizes semantic review; it never authorizes mutation.

### Provenance rehydration

For each candidate, maintenance loads:

- the memory's provenance message IDs;
- its provenance source chat;
- up to six nearby visible messages, capped at eight total context messages;
- current persona and character names associated with that chat; and
- the memory's current kind, scope, status, content, lineage, and fingerprint.

Provenance messages take priority over nearby context. If the complete cited
evidence cannot fit inside the eight-message bound, the outcome is `uncertain`
and maintenance makes no change; an internal context limit is never treated as
missing evidence or permission to discard.

Memory text and chat messages are untrusted data. They are placed in explicit
structured fields and cannot issue instructions to the reviewer.

### Clarification outcomes

Semantic review returns exactly one outcome:

- `clear`: retain the source unchanged;
- `clarify`: provide one standalone replacement supported by cited evidence;
- `discard_irreparable`: the source is context-dependent and the available
  evidence cannot establish its missing referent; or
- `uncertain`: make no change.

Only `clarify` and `discard_irreparable` become actionable maintenance
proposals. A provider failure, malformed result, unsupported rewrite, or
ordinary uncertainty is not an irreparable finding.

### Clarify proposal

Add a single-source `clarify` proposal to the shared TypeScript and Rust memory
maintenance contracts.

Applying a clarification:

1. revalidates the source fingerprint and eligibility;
2. creates a replacement memory with the same owner, scope, kind, confidence,
   and supported provenance;
3. records the source memory ID and clarity policy version in replacement
   lineage;
4. marks the source superseded by the replacement; and
5. records both operations in the existing atomic undo batch.

The source is not edited in place. History remains inspectable and an automatic
cleanup undo can restore the exact prior state.

An irreparable discard uses the existing `discard` operation and its atomic undo
semantics. It is selected only after a successful semantic review establishes
that the memory is context-dependent and its evidence cannot resolve it.

## Safe `{{user}}` Resolution

Stored memory text retains `{{user}}` so the record remains honest when no
persona name exists. Before transcript or canonical memory content is supplied
to a generation model, prompt formatting performs one narrow,
case-insensitive identity substitution:

- replace `{{user}}` and `{{userName}}` with the active chat persona name when
  one exists;
- otherwise leave `{{user}}` intact.

Memory content must not run through the general macro engine. Memories are
untrusted data, and expanding arbitrary macros could execute variable or
content-control behavior that was never intended for recalled facts.

The stored value and Memory Console display remain unchanged.

## Rust Transcript Capture

`message_speaker_label` in `chat_memory.rs` changes its missing-persona fallback
from `User` to `{{user}}`. Configured persona names and known character names
continue to take precedence.

This is a storage-owner correction. It does not summarize or rewrite raw
transcript captures, and it does not change chunking, embedding, or source
message selection.

## Scheduling And Ownership

The TypeScript engine layer owns:

- capture identity/context snapshots;
- consequence prompt construction and validation;
- clarity candidate analysis;
- proposal validation; and
- the automatic maintenance queue lifecycle.

The Rust storage capability owns:

- atomic application and undo of `clarify`;
- canonical lifecycle updates;
- raw transcript speaker fallback; and
- index refresh after mutations.

Existing focused shared API wrappers and remote-runtime dispatch remain the
transport boundary. No React component or new user setting is required.

Clarity work remains subordinate to foreground generation, uses the existing
coalesced maintenance queue, and respects its pass, proposal, oscillation, and
retry bounds. A clarity-policy version is included in maintenance fingerprints
so already reviewed unchanged memories are not repeatedly sent to a model.

## Failure Handling

- Required current-exchange or identity snapshot unavailable: do not enqueue or
  save a degraded automatic canonical memory.
- Capture provider or parser failure: use the existing bounded retry path.
- Source changed before capture: mark the job stale and perform no write.
- Repair provider unavailable, timed out, or malformed: perform no mutation and
  retry according to maintenance policy.
- Missing repair evidence after a successful review: discard only when the
  memory is confirmed context-dependent and irreparable.
- Unsupported replacement, invented ID, changed scope/kind, or failed semantic
  support: reject the proposal and preserve the source.
- Stale source before apply: reject the whole atomic batch and requeue fresh
  analysis.
- Index refresh failure: preserve the durable mutation, record the existing
  repairable index diagnostic, and retry index repair.

Diagnostics include stable IDs, owner scope, stage, and error code. They never
log transcript text, memory content, persona descriptions, or character-card
content.

## Verification

### Focused TypeScript tests

- persona names are snapshotted and used as user labels;
- no-persona capture uses `{{user}}`, never `User`;
- character IDs resolve to names in single and group chats;
- the context window is bounded, ordered, chat-local, and excludes hidden
  messages;
- edits or deletion of reference messages make a queued capture stale;
- `sourceMessageIds` and `referenceMessageIds` keep their distinct authority;
- each reported example produces or accepts a standalone candidate;
- literal `User`, unexplained opening pronouns, invented IDs, and unsupported
  referents are rejected;
- manual, imported, corrected, command-created, tool-created, and edited
  records are excluded from clarity repair;
- provenance-backed vague memories produce validated `clarify` proposals;
- missing evidence can produce `discard_irreparable`;
- provider/parser failure and `uncertain` produce no action; and
- unchanged memories are not repeatedly reviewed under one policy version.

### Focused Rust tests

- raw transcript capture falls back to `{{user}}`;
- configured persona and per-character names still win;
- `clarify` atomically supersedes one source and creates one replacement;
- clarification preserves owner, scope, kind, provenance, and history;
- stale, cross-owner, malformed, protected, or overlapping proposals fail
  without partial writes;
- undo restores the source and removes the replacement effect; and
- embedded and hostable command paths expose the same proposal contract.

### Lane checks

- focused Vitest suites for capture, value review, cleanup, maintenance, memory
  prompt formatting, and prompt assembly;
- focused Rust storage and chat-memory tests;
- `pnpm typecheck`;
- `pnpm check:architecture`;
- `cargo check --manifest-path src-tauri/Cargo.toml`; and
- full `pnpm check` before any shipping request.

### Synthetic semantic evaluation

Run a bounded fixture set through a configured text model using invented
conversations only. Include:

- named and unnamed personas;
- single-character and group exchanges;
- safe pronouns with same-sentence antecedents;
- dangling person pronouns;
- dangling objects and topics;
- deliberately missing provenance;
- conflicting evidence; and
- prompt-injection-shaped memory text.

The evaluation reports accepted, clarified, discarded, and unchanged outcomes
without reading or logging private chats. It is semantic evidence for the
configured model, not a deterministic guarantee for every provider.

## Non-Goals

- General grammar or prose rewriting of clear memories.
- Rewriting manual or explicitly edited memory text.
- Guessing identities from names that do not appear in trusted records.
- Resolving contradictions without evidence.
- Running arbitrary stored macros.
- Adding a new settings surface, progress modal, or routine success toast.
- Expanding automatic capture beyond the bounded local conversation window.
