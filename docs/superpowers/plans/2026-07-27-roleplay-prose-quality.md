# Universal Roleplay Prose Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Subagent delegation is disabled for this workspace. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route only evidence-backed suspicious Roleplay replies through a narrowly constrained editor, while keeping clean and intentionally stylized replies fast and unchanged.

**Architecture:** Extend the existing TypeScript Roleplay quality owner in `src/engine/generation`. A deterministic signal collector decides whether a focused audit is warranted; the auditor may return only exact span replacements, which a fail-closed validator applies to the original response. Standard generation and dry-run share the same correction function, while Conversation and Game remain excluded.

**Tech Stack:** TypeScript 5.9, Vitest 4, existing generation engine and editor agent, React 19 for one settings-copy update.

## Global Constraints

- Apply only to `roleplay` and the legacy `visual_novel` alias.
- Never use explicit, dark, violent, coercive, romantic, or adult fictional content as a quality signal.
- One hard signal may trigger; otherwise require two independent minor signal kinds or one structural pattern present in the candidate and at least two of the previous six visible assistant replies.
- Length, cast coverage, or an English-only rhetorical pattern can never trigger by itself.
- Long, Scene Draft, lyrical, cinematic, and multi-character selections must remain valid.
- Clean or low-confidence replies make no second model call.
- The focused auditor returns exact replacements, not a full rewritten reply.
- Any invalid, ambiguous, overlapping, unauthorized, longer, empty, timed-out, or failed correction preserves the original.
- No Rust, storage schema, provider transport, Conversation policy, or Game policy changes.
- Do not modify a live user chat during testing.
- Do not commit, push, or open a PR; the user's global repository policy requires explicit authorization for those actions.

## Impact Brief Before Editing

```text
Bug: Severe Roleplay repetition, echoing, pacing mismatch, identity drift, and corrupted prose can bypass the current exact-phrase/strict-agency quality gate.
Core claim: The existing quality architecture is sound, but response-side routing and rewrite validation are too narrow.
Likely owner/lane: src/engine/generation Roleplay quality signals, focused audit, and generation orchestration.
Risk: risky
Proof target: Director-style structural failures trigger without content-based rules; clean, lyrical, long, explicit, non-English, multi-character, Conversation, and Game controls do not.
Feedback loop: Vitest signal fixtures -> validator fixtures -> startGeneration/dryRun integration -> live isolated dry-run matrix.
Top hypothesis: Conservative accumulated local evidence can route nuanced failures without making the editor always-on.
```

Falsifiable hypotheses:

1. If accumulated structural evidence is sufficient, a Director-style fixture will produce `shouldAudit: true` without matching sexual vocabulary. Reject if removing content nouns stops the trigger.
2. If selected controls are honored, Long/Scene Draft and lyrical clean fixtures will remain below the routing threshold. Reject if they trigger from length or imagery alone.
3. If span edits constrain the model, ambiguous or overlapping excerpts and newly longer output will preserve the original. Reject if any such fixture changes content.
4. If mode ownership is preserved, equivalent Conversation and Game turns will make one model call. Reject if either receives a Roleplay audit.
5. If fail-open runtime behavior survives, malformed, unavailable, aborted, and timed-out audits will save the original response. Reject if generation fails or saves partial audit output.

---

### Task 1: Establish Baseline And Deterministic Response Routing

**Files:**

- Modify: `src/engine/generation/roleplay-quality-signals.ts`
- Modify: `src/engine/generation/roleplay-quality-signals.spec.ts`

**Interfaces:**

- Consumes: stored message records, candidate prose, latest user input, persona name/description, character names, agency contract, and `chat.promptVariables`.
- Produces:

```ts
export type RoleplayQualitySignalKind =
  | "repeated_phrase"
  | "repeated_opening"
  | "repeated_closing"
  | "repeated_gesture"
  | "user_echo"
  | "rhetorical_repetition"
  | "cast_saturation"
  | "length_mismatch"
  | "malformed_output"
  | "identity_contradiction"
  | "agency_candidate";

export interface RoleplayQualitySignal {
  kind: RoleplayQualitySignalKind;
  severity: "minor" | "high";
  evidence: string[];
  guidance: string;
  occurrences?: number;
}

export interface RoleplayResponseQualityInput {
  content: string;
  messages?: RoleplayQualityMessage[];
  latestUserInput?: unknown;
  personaName?: string | null;
  personaDescription?: string | null;
  characterNames?: string[];
  selectedControls?: Record<string, unknown>;
  agencyContract?: string | null;
  includeQuotedAgencyAssertions?: boolean;
}

export interface RoleplayResponseQualityResult {
  signals: RoleplayQualitySignal[];
  shouldAudit: boolean;
}
```

- [ ] **Step 1: Install the locked dependencies and run the unchanged baseline**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm vitest run src/engine/generation/roleplay-quality-signals.spec.ts src/engine/generation/roleplay-quality-audit.spec.ts src/engine/generation/prompt-assembly.roleplay-quality.spec.ts src/engine/generation/start-generation.dialogue-attribution.spec.ts
```

Expected: install succeeds and all selected tests pass before production edits.

- [ ] **Step 2: Add failing routing fixtures**

Add focused tests that call the public analyzer rather than private regex helpers:

```ts
it("routes a Director-style reply from accumulated structure rather than subject matter", () => {
  const content = [
    "The instruction lands between them. Not softly, but with weight.",
    "You said the chair should make people prove themselves before they are trusted.",
    "Not a suggestion. Not a possibility. A verdict.",
    "—The room waits while every person supplies another polished reaction.",
    "—The silence stretches. —The answer settles. —The moment hangs.",
    "This paragraph repeats the same emotional conclusion until the response is far longer than the user's turn. ".repeat(
      80,
    ),
  ].join("\n\n");
  const result = analyzeRoleplayResponse({
    content,
    latestUserInput: "The chair should make people prove themselves before they are trusted.",
    messages: [
      assistant("The question lands between them. Not gently, but with force."),
      assistant("The name lands between them. Not quietly, but like a judgment."),
    ],
    selectedControls: { length: "flexible length", styleFlavor: "grounded prose" },
  });
  expect(result.shouldAudit).toBe(true);
  expect(result.signals.map((entry) => entry.kind)).toEqual(
    expect.arrayContaining(["user_echo", "rhetorical_repetition", "length_mismatch"]),
  );
});

it.each([
  ["explicit intimacy", "Adult characters continue an invited explicit scene with specific physical detail."],
  ["lyrical prose", "Moonlight combs silver through the reeds while Ilyra listens for the ferryman's bell."],
  ["horror", "The wet footprints stop at the crib. Mara keeps the axe raised and says nothing."],
  ["non-English", "La lluvia golpea la ventana. Mara guarda la carta y espera una respuesta."],
])("does not route one isolated clean %s feature", (_label, content) => {
  expect(analyzeRoleplayResponse({ content, latestUserInput: "Continue." }).shouldAudit).toBe(false);
});

it("honors Long and Scene Draft controls instead of treating size as suspicion", () => {
  const content = Array.from(
    { length: 90 },
    (_, index) => `Distinct scene sentence ${index} changes one concrete fact.`,
  ).join(" ");
  expect(
    analyzeRoleplayResponse({
      content,
      latestUserInput: "Write the full chapter.",
      selectedControls: { length: "length_scene_draft", styleFlavor: "style_lyrical" },
    }).signals.some((entry) => entry.kind === "length_mismatch"),
  ).toBe(false);
});

it("requires two independent minor kinds when no pattern recurs three times", () => {
  const result = analyzeRoleplayResponse({
    content: "Mara repeats the exact user wording about the sealed blue envelope.",
    latestUserInput: "The exact user wording about the sealed blue envelope.",
  });
  expect(result.signals.map((entry) => entry.kind)).toContain("user_echo");
  expect(result.shouldAudit).toBe(false);
});

it("flags an authoritative named-pronoun contradiction without inferring identity", () => {
  const result = analyzeRoleplayResponse({
    content: "Rowan closes the file because she has made her decision.",
    personaName: "Rowan",
    personaDescription: "Pronouns: they/them.",
  });
  expect(result).toEqual(
    expect.objectContaining({
      shouldAudit: true,
      signals: expect.arrayContaining([expect.objectContaining({ kind: "identity_contradiction", severity: "high" })]),
    }),
  );
});

it("flags malformed internal or mixed-script output but not ordinary Unicode", () => {
  expect(analyzeRoleplayResponse({ content: "Mara hand鞭s over the key." }).shouldAudit).toBe(true);
  expect(analyzeRoleplayResponse({ content: "Pokémon, naïve, 東京, and Мария remain valid text." }).shouldAudit).toBe(
    false,
  );
});
```

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```powershell
pnpm vitest run src/engine/generation/roleplay-quality-signals.spec.ts
```

Expected: failures show missing signal kinds, missing `shouldAudit`, or absent control-aware detection—not syntax or fixture errors.

- [ ] **Step 4: Implement minimal signal collection and thresholding**

Keep history guidance intact and add response-side helpers with these exact policies:

```ts
const RECENT_RESPONSE_LIMIT = 6;
const LONG_REQUEST_PATTERN = /\b(?:long|longer|full (?:scene|chapter)|scene draft|monologue|detailed)\b/i;
const INTERNAL_OUTPUT_PATTERN = /<\/?(?:analysis|assistant_response|roleplay_quality|roleplay_quality_audit)\b/i;
const MOJIBAKE_PATTERN = /(?:\uFFFD|Ã.|â(?:€|€™|€œ|€œ|€)|Â[\u00A0-\u00FF])/u;
const MIXED_SCRIPT_WORD_PATTERN =
  /(?:\p{Script=Latin}{2,}\p{Script=Han}\p{Script=Latin}+|\p{Script=Latin}{2,}\p{Script=Cyrillic}\p{Script=Latin}+)/u;
const NEGATION_CONTRAST_PATTERN =
  /\bnot\b[^.!?\n]{0,90}\bbut\b|\bnot\b[^.!?\n]{0,60}[.!?]\s*\bnot\b|\bno\b[^.!?\n]{0,60},\s*\bno\b/giu;

export function shouldAuditRoleplaySignals(signals: RoleplayQualitySignal[]): boolean {
  if (signals.some((entry) => entry.severity === "high")) return true;
  if (new Set(signals.map((entry) => entry.kind)).size >= 2) return true;
  return signals.some((entry) => (entry.occurrences ?? 0) >= 3);
}
```

Implementation details:

- Reuse Unicode normalization and visible-assistant filtering already in the module.
- Candidate repetition compares candidate 3–5 word n-grams and opening families against the previous six visible assistant replies.
- `user_echo` requires a normalized run of at least six user words in the candidate.
- `rhetorical_repetition` requires at least three negation-contrast matches or a dense repeated dash/fragment cadence; it remains minor.
- `length_mismatch` parses `one line`, `under N words`, `N to M words`, and known V2 length IDs. Flexible fallback requires more than 650 words and more than six times the latest user turn; absent controls use a 900-word floor. Long/Scene Draft disables it. It remains minor.
- `cast_saturation` requires at least four configured characters, all named in a reply over 700 words, no character named by the latest user, and no Long/Scene Draft/Cinematic selection. It remains minor.
- `identity_contradiction` requires an explicit `pronouns: x/y` or `uses x/y pronouns` statement and a conflicting pronoun within the named persona's sentence. It never infers pronouns from gender words.
- `malformed_output` is high only for internal tags, replacement/mojibake markers, control characters, or a mixed-script insertion inside one Latin word.
- `agency_candidate` retains its existing strict-only rules.
- Return `{ signals, shouldAudit: shouldAuditRoleplaySignals(signals) }` even when no signals exist.

- [ ] **Step 5: Run the signal suite and refactor only while green**

Run:

```powershell
pnpm vitest run src/engine/generation/roleplay-quality-signals.spec.ts
```

Expected: all signal tests pass, including the existing history and agency coverage.

- [ ] **Step 6: Record a no-commit checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: only the approved design/plan and Task 1 signal files are changed; do not commit.

---

### Task 2: Replace Full Rewrites With Exact Span Validation

**Files:**

- Modify: `src/engine/generation/roleplay-quality-audit.ts`
- Modify: `src/engine/generation/roleplay-quality-audit.spec.ts`
- Modify: `src/engine/contracts/types/chat.ts`

**Interfaces:**

- Consumes: `AgentResult.data.edits`, original candidate, and allowed reason list.
- Produces:

```ts
export type RoleplayQualityChangeReason = "agency" | "continuity" | "repetition" | "pacing" | "malformed";

interface RoleplayQualityReplacementEdit {
  before: string;
  after: string;
  reason: RoleplayQualityChangeReason;
  description: string;
}

export function roleplayQualityReasonsForSignals(signals: RoleplayQualitySignal[]): RoleplayQualityChangeReason[];
```

- [ ] **Step 1: Replace full-rewrite fixtures with failing exact-edit fixtures**

Use this accepted shape:

```ts
const repair = validateRoleplayQualityAudit(
  original,
  result({
    edits: [
      {
        before: '"I accept," Celia says.',
        after: '"Decide when you are ready."',
        reason: "agency",
        description: "Removed dialogue assigned to the persona.",
      },
    ],
  }),
  { allowedReasons: ["agency"] },
);
expect(repair.content).toBe('Mira closes the ledger. "Decide when you are ready."');
```

Add table cases proving the original survives:

```ts
it.each([
  ["missing edits", {}],
  ["empty before", { edits: [{ before: "", after: "New.", reason: "agency", description: "Bad." }] }],
  ["ambiguous before", { edits: [{ before: "Mira", after: "She", reason: "continuity", description: "Bad." }] }],
  [
    "overlap",
    {
      edits: [
        { before: "Mira closes the ledger", after: "Mira shuts it", reason: "pacing", description: "One." },
        { before: "closes the ledger", after: "shuts it", reason: "pacing", description: "Two." },
      ],
    },
  ],
  [
    "longer result",
    {
      edits: [{ before: "closes", after: "very slowly and carefully closes", reason: "pacing", description: "Pads." }],
    },
  ],
  ["unsupported reason", { edits: [{ before: "closes", after: "shuts", reason: "style", description: "Bad." }] }],
  ["unauthorized reason", { edits: [{ before: "closes", after: "shuts", reason: "continuity", description: "Bad." }] }],
  [
    "internal output",
    { edits: [{ before: "closes", after: "<analysis>shuts</analysis>", reason: "pacing", description: "Bad." }] },
  ],
  ["empty final reply", { edits: [{ before: original, after: "", reason: "agency", description: "Bad." }] }],
])("preserves the original for %s", (_label, data) => {
  expect(validateRoleplayQualityAudit(original, result(data), { allowedReasons: ["agency", "pacing"] }).changed).toBe(
    false,
  );
});
```

Add authorization mapping assertions:

```ts
expect(
  roleplayQualityReasonsForSignals([
    signal("agency_candidate"),
    signal("identity_contradiction"),
    signal("repeated_phrase"),
    signal("length_mismatch"),
    signal("malformed_output"),
  ]),
).toEqual(["agency", "continuity", "repetition", "pacing", "malformed"]);
```

- [ ] **Step 2: Run the validator suite and verify RED**

Run:

```powershell
pnpm vitest run src/engine/generation/roleplay-quality-audit.spec.ts
```

Expected: accepted edit does not apply and old `editedText` assumptions fail.

- [ ] **Step 3: Implement unique, non-overlapping, end-to-start replacements**

Implement:

```ts
function exactOccurrences(source: string, excerpt: string): number[] {
  const indexes: number[] = [];
  for (let index = source.indexOf(excerpt); index >= 0; index = source.indexOf(excerpt, index + 1)) {
    indexes.push(index);
  }
  return indexes;
}

const positioned = edits.map((edit) => {
  const indexes = exactOccurrences(original, edit.before);
  if (indexes.length !== 1) throw new Error("ambiguous edit");
  return { ...edit, start: indexes[0]!, end: indexes[0]! + edit.before.length };
});

positioned.sort((left, right) => left.start - right.start);
if (positioned.some((edit, index) => index > 0 && edit.start < positioned[index - 1]!.end)) {
  return unchanged(original, durationMs);
}

let edited = original;
for (const edit of [...positioned].sort((left, right) => right.start - left.start)) {
  edited = edited.slice(0, edit.start) + edit.after + edited.slice(edit.end);
}
```

Validate at most six edits; non-empty `before`; string `after`; supported/authorized reason; non-empty description; no no-op; no internal tags/structured output; no longer final result; non-empty trimmed result. Metadata evidence is the bounded `before` excerpt. Map signal kinds to reasons with a stable deduplicated order.

Update `RoleplayQualityCorrectionExtra.reasons` in `chat.ts` to the five-reason union.

- [ ] **Step 4: Run the validator suite**

Run:

```powershell
pnpm vitest run src/engine/generation/roleplay-quality-audit.spec.ts
```

Expected: all accepted, rejected, authorization, metadata-bound, and no-op cases pass.

- [ ] **Step 5: Record a no-commit checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: Task 2 files are added to the existing intended diff; do not commit.

---

### Task 3: Wire The Evidence Gate Through Editor, Generation, And Dry Run

**Files:**

- Modify: `src/engine/contracts/constants/agent-prompts.ts`
- Modify: `src/engine/contracts/constants/agent-prompts.spec.ts`
- Modify: `src/engine/generation/agent-runner.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Modify: `src/engine/generation/start-generation.dialogue-attribution.spec.ts`
- Modify: `src/engine/generation/start-generation.bunny.test.ts`
- Modify: `src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx`
- Modify: `src/features/shell/settings/lib/settings-information-architecture.spec.ts`

**Interfaces:**

- `runFocusedRoleplayQualityAudit` accepts any authorized quality signal; an agency signal additionally requires the authoritative agency contract.
- `applyAutomaticRoleplayQualityCorrection` remains the single standard/dry-run correction owner.
- `GenerationDryRunResult` adds `roleplayQualityCorrection: RoleplayQualityCorrectionExtra | null`.

- [ ] **Step 1: Add failing prompt-contract tests**

Assert the focused prompt:

```ts
expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain('"edits"');
expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain('"before"');
expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain('"after"');
expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain("Do not return the complete response");
expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).toContain("explicit, dark, violent, or sexual content");
expect(ROLEPLAY_QUALITY_EDITOR_PROMPT).not.toContain('"editedText"');
```

- [ ] **Step 2: Add failing generation integration tests**

Update strict-agency mocks to return `edits`. Add:

```ts
it("audits accumulated prose signals without requiring strict agency", async () => {
  const { storage, messages } = roleplayAttributionStorage(
    {},
    { promptVariables: { length: "under 150 words", styleFlavor: "grounded prose" } },
  );
  const original = [
    "The exact sealed blue envelope must be opened before dawn.",
    "Not carefully, but completely. Not later, but now. Not privately, but before everyone.",
    "The same polished conclusion repeats without adding state. ".repeat(30),
  ].join(" ");
  const before = "Not carefully, but completely. Not later, but now. Not privately, but before everyone.";
  const llm = roleplayLlm([
    original,
    JSON.stringify({
      edits: [
        {
          before,
          after: "Open it before dawn, in front of everyone.",
          reason: "repetition",
          description: "Collapsed repeated contrast.",
        },
      ],
    }),
  ]);
  await collectEvents(
    startGeneration(
      { storage, llm, integrations: {} as IntegrationGateway },
      {
        chatId: "chat-1",
        connectionId: "conn-1",
        userMessage: "The exact sealed blue envelope must be opened before dawn.",
      },
    ),
  );
  expect(llm.requests).toHaveLength(2);
  expect(messages.find((item) => item.role === "assistant")?.content).toContain("Open it before dawn");
});
```

Add clean controls for explicit intimacy, lyrical Long, non-English, and multi-character prose that each assert one request. Add equivalent `mode: "conversation"` and `mode: "game"` cases that assert one request. Retain timeout, malformed audit, disabled toggle, direct-messages, and strict-agency tests.

Add a dry-run integration case whose suspicious main response receives one validated span edit, returns corrected `dry_run_result.content`, includes correction metadata, makes two model requests, and records zero storage writes.

- [ ] **Step 3: Run new integration tests and verify RED**

Run:

```powershell
pnpm vitest run src/engine/contracts/constants/agent-prompts.spec.ts src/engine/generation/start-generation.dialogue-attribution.spec.ts src/engine/generation/start-generation.bunny.test.ts
```

Expected: failures identify the old full-response schema, strict-agency-only gate, and dry-run omission.

- [ ] **Step 4: Change the focused editor prompt to exact edits**

Use this contract:

```ts
export const ROLEPLAY_QUALITY_EDITOR_PROMPT = `You are a focused Roleplay quality editor.
Audit only the generated text inside <assistant_response>. The supplied typed signals are routing evidence, not proof; return no edits when they are false positives.

Never sanitize, soften, or reject explicit, dark, violent, coercive, romantic, or sexual fictional content merely because of its subject matter. Preserve character voice, events, intent, intensity, formatting, user steering, and quoted dialogue outside an authorized problem span. Do not continue the scene.

For agency, obey the supplied agencyContract exactly. For continuity, repetition, pacing, or malformed prose, edit only a span directly supported by the corresponding signal.

Do not return the complete response. Return at most six minimal exact replacements. Each before value must be copied exactly from the response and must identify one unique span. Keep after no longer than before whenever possible. Return an empty edits array when no safe correction is needed.

Respond ONLY with valid JSON:
{
  "edits": [
    {
      "before": "exact unique excerpt from the response",
      "after": "replacement text, or an empty string for deletion",
      "reason": "agency|continuity|repetition|pacing|malformed",
      "description": "brief description of the minimal correction"
    }
  ]
}`;
```

- [ ] **Step 5: Pass bounded evidence and remove the prose-only agency requirement**

In `agent-runner.ts`, require a non-empty agency contract only when `audit.signals` contains `agency_candidate`. Include in `policyJson`:

```ts
{
  agencyContract,
  selectedControls: parseRecord(input.chat.promptVariables),
  latestUserInput: latest visible user content from input.storedMessages,
  persona: input.persona ? { name: input.persona.name, description: input.persona.description } : null,
  characters: input.characters.map(({ name }) => name),
  signals: audit.signals.slice(0, 6).map(({ kind, severity, evidence, occurrences }) => ({
    kind,
    severity,
    evidence: evidence.slice(0, 3),
    occurrences: occurrences ?? 1,
  })),
}
```

Escape `<` in serialized policy exactly as the existing code does.

- [ ] **Step 6: Route accumulated evidence in standard generation**

Call:

```ts
const analysis = analyzeRoleplayResponse({
  content: args.content,
  messages: args.runtimeInput.storedMessages,
  latestUserInput: latest visible user content,
  personaName: args.runtimeInput.persona?.name ?? null,
  personaDescription: args.runtimeInput.persona?.description ?? null,
  characterNames: args.runtimeInput.characters.map((character) => character.name),
  selectedControls: parseRecord(args.chat.promptVariables),
  agencyContract: args.agencyContract,
});
if (!analysis.shouldAudit) return { content: args.content, correction: null };
const allowedReasons = roleplayQualityReasonsForSignals(analysis.signals);
```

Pass all bounded triggering signals to the focused audit and the mapped reasons to the validator. Preserve the eight-second timeout, abort propagation, disabled toggle, impersonation exclusion, and fail-open catch.

- [ ] **Step 7: Reuse the same gate in dry run**

After dry-run regex and incomplete-tail processing, construct a `GenerationAgentRuntimeInput` from the already assembled chat, connection, messages, characters, persona, lorebook entries, summary, and signal. Call `applyAutomaticRoleplayQualityCorrection`, emit `content_replace` only if it changed, and add correction metadata to `GenerationDryRunResult`. Do not invoke normal agent pipelines or any storage writes.

- [ ] **Step 8: Update the existing settings copy**

Use:

```tsx
<Section
  label="Roleplay Quality"
  icon={<Sparkles size="0.875rem" />}
  help="Quiet protection against high-confidence prose and strict-agency problems."
>
  ...
  <p className="mt-0.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
    Clean replies stay fast and use no extra model call. De-Koi reviews only replies with strong local evidence and
    keeps the original whenever a correction is uncertain or fails.
  </p>
</Section>
```

Update the static settings architecture assertion to require the new copy.

- [ ] **Step 9: Run focused integration suites**

Run:

```powershell
pnpm vitest run src/engine/contracts/constants/agent-prompts.spec.ts src/engine/generation/roleplay-quality-signals.spec.ts src/engine/generation/roleplay-quality-audit.spec.ts src/engine/generation/prompt-assembly.roleplay-quality.spec.ts src/engine/generation/start-generation.dialogue-attribution.spec.ts src/engine/generation/start-generation.bunny.test.ts src/features/shell/settings/lib/settings-information-architecture.spec.ts
```

Expected: all focused suites pass; clean controls show one model request, suspicious controls show two, and dry run records no writes.

- [ ] **Step 10: Record a no-commit checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: only approved Roleplay quality, tests, copy, design, and plan files are changed; do not commit.

---

### Task 4: Run Broad Deterministic And Real-Model Verification

**Files:**

- Create: `docs/presets/roleplay-prose-quality-benchmark-results.md`
- Modify only if a new failing proof requires it: Task 1–3 files listed above, always with a new failing test first.

**Interfaces:**

- Deterministic verification covers every routing and validator boundary.
- Real-model verification uses `dryRunGeneration`, the normal prompt assembly, `/api/llm/stream`, and the focused editor against an isolated temporary data copy.

- [ ] **Step 1: Run the full Roleplay quality matrix and type/architecture checks**

Run:

```powershell
pnpm vitest run src/engine/generation/roleplay-quality-signals.spec.ts src/engine/generation/roleplay-quality-audit.spec.ts src/engine/generation/prompt-assembly.roleplay-quality.spec.ts src/engine/generation/start-generation.dialogue-attribution.spec.ts src/engine/generation/start-generation.bunny.test.ts src/features/shell/settings/lib/settings-information-architecture.spec.ts
pnpm typecheck
pnpm check:architecture
```

Expected: all commands exit zero.

- [ ] **Step 2: Create an isolated runtime copy safely**

Resolve the source and destination as absolute paths, ensure the destination is below a newly created temp directory, and copy rather than move:

```powershell
$sourceData = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'com.de-koi.app'))
$benchmarkRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('de-koi-roleplay-quality-' + [guid]::NewGuid().ToString('N'))))
if (-not $benchmarkRoot.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Benchmark root escaped the temporary directory.'
}
New-Item -ItemType Directory -Path $benchmarkRoot | Out-Null
$benchmarkData = Join-Path $benchmarkRoot 'data-copy'
Copy-Item -LiteralPath $sourceData -Destination $benchmarkData -Recurse
```

Expected: a unique temporary copy exists; the real app data remains untouched.

- [ ] **Step 3: Start the branch runtime and frontend against the isolated copy**

Create a clean detached baseline worktree once, without touching the dirty primary checkout:

```powershell
$baselineWorktree = [IO.Path]::GetFullPath('D:\dev\de-koi-roleplay-prose-quality-baseline-worktree')
if (-not (Test-Path -LiteralPath $baselineWorktree)) {
  git worktree add --detach $baselineWorktree origin/main
}
```

Install its locked dependencies with `pnpm install --frozen-lockfile`. Use hidden background windows and unused loopback ports:

```powershell
$serverEnv = @{
  DE_KOI_DATA_DIR = $benchmarkData
  DE_KOI_SERVER_ADDR = '127.0.0.1:18787'
}
```

Start `cargo run --manifest-path src-tauri/Cargo.toml --bin de-koi-server` with those environment variables and `-WindowStyle Hidden`. Start `pnpm dev -- --host 127.0.0.1 --port 1427` hidden. Verify `http://127.0.0.1:18787/health?probe=1` before opening the frontend. In Settings, set **Remote Runtime URL** to `http://127.0.0.1:18787` and wait for the built-in health display to report that the runtime and storage are available; do not add a raw engine fetch.

- [ ] **Step 4: Create synthetic benchmark resources only in the copy**

Using the app's typed storage API through the isolated frontend/runtime, create one synthetic persona and a small synthetic character set with explicit identities, varied voices, and no private chat content. Create benchmark Roleplay chats that use Universal V2 and the copied runnable connection. Do not create or update records in the source data directory or Pi runtime.

- [ ] **Step 5: Run eight normal-path dry-run scenarios**

Use identical connection and generation parameters for before/after comparisons:

1. tense dialogue;
2. readable action;
3. slow emotional restraint;
4. multi-character debate;
5. horror/dark fiction;
6. invited adult romance/intimacy;
7. intentionally long lyrical Scene Draft;
8. short grounded exchange.

Run scenarios 1 and 4 for three turns each to test conversation-local repetition. Record for every final reply:

```text
scenario
provider/model
selected controls
main-call count
audit-call count
latency
word count
signal kinds
correction reasons
original or changed
continuity
agency
voice
specificity
pacing
non-repetition
state change
selected-style preservation
```

Before comparisons use the detached `origin/main` baseline worktree with the same isolated-data snapshot and ports. Stop its exact process IDs before starting this branch on those ports. After comparisons use this branch. Shuffle A/B labels before scoring.

- [ ] **Step 6: Evaluate the acceptance bar honestly**

Pass only if:

- all deliberately flawed deterministic fixtures route;
- all deterministic clean controls stay local;
- clean live outputs make one model call;
- any live audit is source-backed and span-valid;
- post-fix output is preferred in at least six of eight scenario comparisons;
- no scenario has a critical continuity, agency, voice, or selected-style regression;
- explicit, lyrical, long, and multi-character scenarios remain recognizable and unsanitized.

If a scenario exposes a deterministic bug, add a failing Vitest fixture, observe RED, implement the minimum correction, rerun GREEN, then rerun the affected live scenario. Do not tune to character names or scenario vocabulary.

- [ ] **Step 7: Write the benchmark result**

Create `docs/presets/roleplay-prose-quality-benchmark-results.md` with:

- date, branch, before/after revisions, path used, provider/model, and isolation method;
- the eight scenario table and multi-turn notes;
- anonymized shuffled preference results;
- deterministic metric summary and second-call counts;
- examples of accepted/rejected exact edits;
- provider limitations and any skipped second-provider check;
- explicit acceptance pass/fail conclusion.

- [ ] **Step 8: Stop temporary processes and remove only the verified temp copy**

Stop the exact server/frontend process IDs started in Step 3. Resolve `$benchmarkRoot`, verify again that it is under the system temp directory and its leaf begins `de-koi-roleplay-quality-`, then remove that exact path recursively with PowerShell `Remove-Item -LiteralPath`. Report that the temporary copy was removed and was not recoverable; source app data was untouched.

- [ ] **Step 9: Run final verification**

Run:

```powershell
pnpm vitest run src/engine/generation/roleplay-quality-signals.spec.ts src/engine/generation/roleplay-quality-audit.spec.ts src/engine/generation/prompt-assembly.roleplay-quality.spec.ts src/engine/generation/start-generation.dialogue-attribution.spec.ts src/engine/generation/start-generation.bunny.test.ts src/features/shell/settings/lib/settings-information-architecture.spec.ts
pnpm typecheck
pnpm check:architecture
pnpm check:bunny-review
git diff --check
git status --short
```

Expected: all validation exits zero; status lists only intended uncommitted files.

---

### Task 5: Bunny Review And Final Impact Receipt

**Files:**

- Modify only if Bunny identifies an actionable issue: the smallest already-owned file plus a failing regression test.
- Update: `docs/presets/roleplay-prose-quality-benchmark-results.md` if final verification changes measured results.

- [ ] **Step 1: Run the Bunny skill review over the complete diff**

Review scope:

- false-positive routing;
- adult/dark-content neutrality;
- selected-control preservation;
- span ambiguity/overlap and prompt injection;
- timeout/abort/fail-open behavior;
- dry-run no-write parity;
- Roleplay/Conversation/Game separation;
- metadata contract compatibility;
- large-file and import-direction concerns.

- [ ] **Step 2: Fix each actionable issue with TDD**

For every accepted finding: add a focused failing test, observe RED, make the minimum production change, observe GREEN, and rerun the affected integration suite. Do not make speculative cleanup changes.

- [ ] **Step 3: Complete the final impact receipt**

Report:

```text
Behavior changed:
Primary files:
Owner fixed:
Affected callers reviewed:
Mode impact:
Shared layer impact:
Rust/TS boundary impact:
Verification:
Feedback loop rerun:
Debug cleanup:
Not touched:
Remaining risk:
Vault:
```

Required content:

- Owner fixed: `src/engine/generation` Roleplay quality path.
- Affected callers: standard agent branch, direct-messages branch, dry run, swipe persistence, settings toggle.
- Mode impact: Roleplay and `visual_novel` only; Conversation and Game negative tests.
- Shared layer impact: chat metadata union and shared settings copy only.
- Rust/TS boundary: none.
- Not touched: live chats, provider credentials, adult-content boundary, Universal V2 preset content, Rust storage/runtime.
- Remaining risk: model judgment and provider variance; benchmark proves only configured provider snapshots.
- Vault: no vault files changed.

- [ ] **Step 4: Present the uncommitted result**

Include changed files, deterministic and live verification, benchmark acceptance, manual gaps, remaining risk, and the exact worktree path. Do not commit, push, create a PR, or merge without a new explicit user request.
