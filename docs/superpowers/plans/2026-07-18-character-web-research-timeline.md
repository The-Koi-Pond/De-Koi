# Character Web Research Timeline Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep character web-research permission cards and source links available after the chat timeline refreshes.

**Architecture:** Repair the existing timeline storage projection at its catalog-chat owner. The generation engine and UI already write and consume the correct metadata, so the change only expands the allowlisted `extra` fields returned for timeline rows.

**Tech Stack:** TypeScript, Vitest, pnpm

## Global Constraints

- Preserve the existing one-query consent and grant behavior.
- Do not change provider, Rust, generation, or UI code.
- Validate the shared projection with the focused test, typecheck, architecture check, and full repository check.

---

### Task 1: Preserve web-research metadata in timeline rows

**Files:**
- Modify: `src/features/catalog/chats/lib/timeline-message.spec.ts`
- Modify: `src/features/catalog/chats/lib/timeline-message.ts`

**Interfaces:**
- Consumes: `timelineMessageProjection(): ChatMessageListOptions`
- Produces: `fieldSelections.extra` containing `characterWebResearchRequest` and `characterWebResearchSources`

- [ ] **Step 1: Write the failing regression test**

Add this test inside `describe("timelineMessageProjection")`:

```ts
it("requests character web research metadata needed after timeline refresh", () => {
  const projection = timelineMessageProjection();

  expect(projection.fieldSelections?.extra).toEqual(
    expect.arrayContaining(["characterWebResearchRequest", "characterWebResearchSources"]),
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm vitest run src/features/catalog/chats/lib/timeline-message.spec.ts
```

Expected: one failure because the two fields are absent from the projection.

- [ ] **Step 3: Add the two fields to the projection**

Add these entries to `CHAT_MESSAGE_TIMELINE_EXTRA_FIELDS`:

```ts
"characterWebResearchRequest",
"characterWebResearchSources",
```

- [ ] **Step 4: Run focused and lane validation**

Run:

```powershell
pnpm vitest run src/features/catalog/chats/lib/timeline-message.spec.ts
pnpm typecheck
pnpm check:architecture
pnpm check
```

Expected: all commands pass.

- [ ] **Step 5: Commit the repair**

```powershell
git add -- src/features/catalog/chats/lib/timeline-message.spec.ts src/features/catalog/chats/lib/timeline-message.ts
git commit -m "chat: preserve character web research timeline metadata"
```

### Task 2: Review and publish

**Files:**
- Review all changes against `origin/main`.

**Interfaces:**
- Consumes: committed repair and validation evidence.
- Produces: merged pull request targeting `The-Koi-Pond/De-Koi:main`.

- [ ] **Step 1: Run diff safety checks and Bunny**

Run:

```powershell
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Review the final code, scope, regression proof, and PR wording under the Bunny contract.

- [ ] **Step 2: Push and open a ready pull request**

Push only to `origin`, create the PR against `main`, and include root cause and validation evidence.

- [ ] **Step 3: Monitor required checks and repair in-scope failures**

Inspect GitHub Actions, Bunny, PR health, and unresolved review threads. Apply and verify any in-scope repairs.

- [ ] **Step 4: Merge**

Merge only after required checks are green and Bunny passes, then verify the PR reports `MERGED`.
