# Character-Scoped Memory Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep canonical recall chat-local plus answering-character-local across multi-character conversation replies.

**Architecture:** Prompt assembly owns generation-target scoping. It will pass only the requested participant into canonical-memory retrieval and will invalidate reusable source-sensitive context when the effective participant target changes.

**Tech Stack:** TypeScript, Vitest, De-Koi prompt assembly, canonical-memory storage gateway.

## Global Constraints

- Preserve chat-scoped canonical memories for every reply in the active chat.
- Preserve existing behavior when no valid character target exists.
- Do not change persisted memory records, storage commands, or UI behavior.
- Keep conversation, roleplay, and game generation ownership separate.

---

### Task 1: Prove target leakage and stale reuse

**Files:**

- Modify: `src/engine/generation/canonical-memory-context.spec.ts`

**Interfaces:**

- Consumes: `assembleGenerationPrompt(storage, input)` and its returned `reusableContext`.
- Produces: A regression test covering consecutive `forCharacterId` values in one group conversation.

- [x] **Step 1: Extend the prompt storage fixture**

Make the fixture return both group characters and return canonical memories by the scope in each query. This ensures the test exercises production query scoping rather than a mock that returns every row.

- [x] **Step 2: Write the failing group-conversation test**

Assemble Jester's prompt with `forCharacterId: "jester"`, then assemble Harlequin's prompt with `forCharacterId: "harlequin"` and Jester's `reusableContext`. Assert each prompt contains the active chat memory and only the answering character's memory.

- [x] **Step 3: Verify RED**

Run:

```powershell
pnpm vitest run src/engine/generation/canonical-memory-context.spec.ts
```

Expected: the new test fails because Jester sees Harlequin's memory and Harlequin reuses Jester's memory block.

---

### Task 2: Scope canonical recall and reusable context

**Files:**

- Modify: `src/engine/generation/prompt-assembly.ts`
- Test: `src/engine/generation/canonical-memory-context.spec.ts`

**Interfaces:**

- Consumes: `requestedCharacterTarget(input, characters)` and `PromptAssemblyReusableContext.macroSensitiveScope`.
- Produces: target-aware canonical-memory character input and target-aware reusable-context matching.

- [x] **Step 1: Implement the minimal owner-level fix**

Derive the effective target character once. Use that target to select canonical-memory characters. Include the effective target in reusable-context scope matching so target changes rebuild source-sensitive context.

- [x] **Step 2: Verify GREEN**

Run:

```powershell
pnpm vitest run src/engine/generation/canonical-memory-context.spec.ts
```

Expected: all tests pass.

- [x] **Step 3: Run affected prompt tests**

Run:

```powershell
pnpm vitest run src/engine/generation/canonical-memory-context.spec.ts src/engine/generation/prompt-assembly.context-priority.spec.ts
pnpm typecheck
pnpm check:architecture
```

Expected: all commands exit successfully.

- [x] **Step 4: Run the full shipping gate**

Run:

```powershell
pnpm check
```

Expected: exit code 0.

- [x] **Step 5: Commit the intended files**

Stage only the design, plan, prompt assembly, and regression test. Commit with:

```powershell
git commit -m "fix: scope group recall to the answering character"
```
