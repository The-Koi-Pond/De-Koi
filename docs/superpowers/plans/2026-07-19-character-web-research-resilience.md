# Character Web Research Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give De-Koi consent-gated web research an automatic Brave-to-Bing fallback, quiet immersive presentation, collapsed citations, and organic character tool-choice guidance.

**Architecture:** A provider-neutral Rust module owns search transport, provider adapters, fallback, and cooldown while character and Deki owners retain consent and domain filtering. The TypeScript generation engine owns research presentation and tool guidance; shared chat UI owns the per-chat setting and collapsed source disclosure.

**Tech Stack:** Rust, Tokio, reqwest, serde, TypeScript, Vitest, React, Testing Library, Tauri commands, hostable HTTP dispatch.

## Global Constraints

- Keep exact-query, exact-chat, allowed-domain, expiry, public-host, and secret-URL grant checks unchanged.
- Add no required third-party account, API key, paid service, or new runtime dependency.
- Missing `characterWebResearchPresentation` metadata resolves to `"quiet"`.
- Quiet mode preserves required consent cards and final citations while hiding intermediate narration, reasoning, tool activity, retries, and raw provider errors.
- Final sources render collapsed by default and expand only on user action.
- Conversation and Roleplay consume the shared behavior; Game mode remains unchanged.
- Deki-senpai reuses search transport only and retains its own prompt, consent UI, grants, and result handling.
- Use focused shared API wrappers and preserve both embedded Tauri and hostable HTTP command paths.
- Run `pnpm check:architecture` after architecture-sensitive changes.

---

## File Map

### Create

- `src-tauri/src/commands/storage/web_search.rs`: provider-neutral search result type, Brave and Bing adapters, fallback, cooldown, diagnostics, and focused Rust tests.
- `src/engine/generation/web-research-presentation.ts`: pure presentation parsing and turn-visibility helpers.
- `src/engine/generation/web-research-presentation.spec.ts`: quiet/visible policy and web-tool-turn classification tests.
- `src/engine/generation/start-generation.web-research-presentation.spec.ts`: public generation-stream proof for hidden intermediate web turns and visible final answers.

### Modify

- `src-tauri/src/commands/storage.rs`: register the shared `web_search` module.
- `src-tauri/src/commands/storage/web_research.rs`: delegate character search transport to shared search and retain grant/domain filtering.
- `src-tauri/src/commands/storage/deki.rs`: delegate Deki search transport to shared search and remove duplicate Brave/DuckDuckGo parsing.
- `src/engine/contracts/types/chat.ts`: type `characterWebResearchPresentation`.
- `src/engine/generation/tools-runtime.ts`: generate presentation-aware, organic research tool guidance and return presentation in `MainToolDefinitions`.
- `src/engine/generation/tools-runtime.main.spec.ts`: prove positive/negative/no-magic-phrase and quiet/visible descriptions.
- `src/engine/generation/character-web-research.ts`: parse presentation and keep quiet request content empty.
- `src/engine/generation/character-web-research.spec.ts`: prove default quiet and visible request content.
- `src/engine/generation/start-generation.ts`: defer per-turn events and discard intermediate web-tool narration/reasoning in quiet mode.
- `src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.tsx`: collapsed final source disclosure.
- `src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.spec.tsx`: collapsed/expanded source behavior.
- `src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx`: per-chat immersive research toggle.
- `src/features/shell/settings/lib/settings-information-architecture.spec.ts`: setting placement and metadata contract.
- `src/features/shell/discovery/discovery-entries.json`: describe background research and collapsed sources.

---

### Task 1: Shared Rust provider chain

**Files:**
- Create: `src-tauri/src/commands/storage/web_search.rs`
- Modify: `src-tauri/src/commands/storage.rs`
- Modify: `src-tauri/src/commands/storage/web_research.rs`

**Interfaces:**
- Produces:

```rust
#[derive(Clone, Debug, Serialize)]
pub(crate) struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

pub(crate) struct WebSearchResponse {
    pub provider: WebSearchProvider,
    pub results: Vec<WebSearchResult>,
}

pub(crate) async fn search(
    query: &str,
    max_results: usize,
    user_agent: &str,
) -> AppResult<WebSearchResponse>;
```

- Character consent and URL filtering remain in `storage/web_research.rs`.

- [ ] **Step 1: Add failing provider parser and fallback tests**

Add focused tests in `web_search.rs` using representative Brave and Bing fixtures. The fallback harness must provide a Brave `429` followed by a Bing `200` and assert that Bing results win:

```rust
#[tokio::test]
async fn throttled_brave_falls_through_to_bing() {
    let responses = VecDeque::from([
        fake_response(WebSearchProvider::Brave, 429, ""),
        fake_response(WebSearchProvider::Bing, 200, BING_FIXTURE),
    ]);
    let response = search_with_fetcher(
        "NASA Gateway latest",
        4,
        "De-Koi test",
        local_cooldowns(),
        sequence_fetcher(responses),
    )
    .await
    .expect("Bing fallback should succeed");

    assert_eq!(response.provider, WebSearchProvider::Bing);
    assert_eq!(response.results[0].url, "https://www.nasa.gov/gateway/");
}
```

Also add cases for timeout, 5xx, malformed markup, no results, cooldown skip, and exhausted providers.

- [ ] **Step 2: Run the Rust test and confirm red**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml web_search --lib
```

Expected: compilation failure because `web_search` and its provider interfaces do not exist.

- [ ] **Step 3: Implement provider-neutral adapters and cooldown**

Create `web_search.rs` with:

```rust
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum WebSearchProvider {
    Brave,
    Bing,
}

const PROVIDERS: [WebSearchProvider; 2] = [
    WebSearchProvider::Brave,
    WebSearchProvider::Bing,
];
const THROTTLE_COOLDOWN: Duration = Duration::from_secs(60);
```

Build provider URLs as:

```rust
WebSearchProvider::Brave => {
    Url::parse_with_params("https://search.brave.com/search", &[("q", query)])
}
WebSearchProvider::Bing => {
    Url::parse_with_params("https://www.bing.com/search", &[("q", query)])
}
```

Parse only Brave `data-type="web"` blocks and Bing `li.b_algo` result blocks. Normalize HTML entities, strip tags, deduplicate URLs, cap to `max_results`, and reject an empty parse as a retryable provider failure.

Use a process-wide `OnceLock<Mutex<HashMap<WebSearchProvider, Instant>>>` for 429 cooldowns. Never hold the mutex across `.await`. Treat 429, 5xx, transport failures, timeouts, malformed markup, and empty results as fallback conditions. Return:

```rust
AppError::new(
    "web_search_providers_exhausted",
    "No web search provider returned usable results.",
)
```

only after every provider is skipped or fails. Log provider selection and fallback reasons through Rust diagnostics without adding provider names to model-visible prose.

The internal testable runner accepts a fetch closure with this shape:

```rust
type FetchFuture = Pin<Box<dyn Future<Output = Result<ProviderHttpResponse, String>> + Send>>;

async fn search_with_fetcher<F>(
    query: &str,
    max_results: usize,
    user_agent: &str,
    cooldowns: &Mutex<HashMap<WebSearchProvider, Instant>>,
    fetch: F,
) -> AppResult<WebSearchResponse>
where
    F: FnMut(WebSearchProvider, Url, &str) -> FetchFuture;
```

Production supplies a reqwest closure; tests supply a `VecDeque<ProviderHttpResponse>`. A successful provider removes its own cooldown entry.

- [ ] **Step 4: Register the module and delegate character search**

In `src-tauri/src/commands/storage.rs` add:

```rust
pub(crate) mod web_search;
```

In `storage/web_research.rs`, replace direct Brave transport with:

```rust
let response = super::web_search::search(
    &effective_query,
    max_results,
    "De-Koi character web research/1.0",
)
.await?;
let results = filter_search_results(
    response
        .results
        .into_iter()
        .map(|result| {
            json!({
                "title": result.title,
                "url": result.url,
                "snippet": result.snippet,
            })
        })
        .collect(),
    &grant,
);
```

Keep the existing grant validation and final allowed-domain/public-URL filter intact.

- [ ] **Step 5: Run focused Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml web_search --lib
cargo test --manifest-path src-tauri/Cargo.toml web_research --lib
```

Expected: provider fallback tests and existing character grant/security tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/storage.rs \
  src-tauri/src/commands/storage/web_search.rs \
  src-tauri/src/commands/storage/web_research.rs
git commit -m "web research: add resilient search providers"
```

---

### Task 2: Reuse the provider chain from Deki

**Files:**
- Modify: `src-tauri/src/commands/storage/deki.rs`

**Interfaces:**
- Consumes: `super::web_search::search(query, max_results, user_agent)`.
- Preserves: `DekiWebResearchGrant`, exact-query matching, allowed domains, action message IDs, and Deki's JSON tool response.

- [ ] **Step 1: Change the existing Deki parser test to require shared Bing results**

Replace the direct `deki_web_search_url`/Brave parser expectation with an adapter expectation that maps:

```rust
WebSearchResult {
    title: "NASA Gateway".into(),
    url: "https://www.nasa.gov/gateway/".into(),
    snippet: "Latest Gateway mission information.".into(),
}
```

to the existing Deki JSON result shape.

- [ ] **Step 2: Run the focused Deki tests and confirm red**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml deki_web --lib
```

Expected: failure because Deki still owns direct Brave transport and duplicate parsing.

- [ ] **Step 3: Delegate Deki search transport**

Replace `deki_web_search_url`, the direct reqwest search request, and duplicate Brave/DuckDuckGo result parsing with:

```rust
let response = super::web_search::search(
    &effective_query,
    max_results,
    "De-Koi Deki-senpai web research/1.0",
)
.await?;
let results = response
    .results
    .into_iter()
    .map(|result| {
        json!({
            "title": result.title,
            "url": result.url,
            "snippet": result.snippet,
        })
    })
    .collect::<Vec<_>>();
```

Keep Deki's grant, action, and allowed-domain handling unchanged. Remove only helpers and tests made obsolete by the shared provider module.

Before returning results, retain only URLs accepted by `deki_web_page_url_for_grant(url, grant)`. This makes provider fallback preserve the approved domain boundary rather than relying only on `site:` query syntax.

- [ ] **Step 4: Run focused and full Rust checks**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml deki_web --lib
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: Deki web tests pass and the Tauri workspace checks successfully.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/storage/deki.rs
git commit -m "deki: reuse resilient web search"
```

---

### Task 3: Quiet research presentation in the generation engine

**Files:**
- Create: `src/engine/generation/web-research-presentation.ts`
- Create: `src/engine/generation/web-research-presentation.spec.ts`
- Create: `src/engine/generation/start-generation.web-research-presentation.spec.ts`
- Modify: `src/engine/contracts/types/chat.ts`
- Modify: `src/engine/generation/character-web-research.ts`
- Modify: `src/engine/generation/character-web-research.spec.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Modify: `src/engine/generation/tools-runtime.ts`
- Modify: `src/engine/generation/tools-runtime.main.spec.ts`

**Interfaces:**
- Produces:

```ts
export type CharacterWebResearchPresentation = "quiet" | "visible";

export function characterWebResearchPresentation(metadata: unknown):
  CharacterWebResearchPresentation;

export function isCharacterWebToolName(name: string): boolean;
```

- Produces and consumes: `MainToolDefinitions.characterWebResearchPresentation`.

- [ ] **Step 1: Write failing pure presentation tests**

In `web-research-presentation.spec.ts` assert:

```ts
expect(characterWebResearchPresentation({})).toBe("quiet");
expect(characterWebResearchPresentation({ characterWebResearchPresentation: "quiet" })).toBe("quiet");
expect(characterWebResearchPresentation({ characterWebResearchPresentation: "visible" })).toBe("visible");
expect(isCharacterWebToolName("request_character_web_research")).toBe(true);
expect(isCharacterWebToolName("search_character_web")).toBe(true);
expect(isCharacterWebToolName("read_character_web_page")).toBe(true);
expect(isCharacterWebToolName("save_lorebook_entry")).toBe(false);
```

Extend `character-web-research.spec.ts`:

```ts
expect(characterWebResearchRequestContent("narration", "reason", "quiet")).toBe("");
expect(characterWebResearchRequestContent("", "reason", "visible")).toBe("reason");
```

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
pnpm vitest run src/engine/generation/web-research-presentation.spec.ts \
  src/engine/generation/character-web-research.spec.ts
```

Expected: missing module and function signature failures.

- [ ] **Step 3: Implement presentation parsing and request content**

Add the chat metadata type:

```ts
characterWebResearchPresentation?: "quiet" | "visible";
```

Implement the pure helpers and update:

```ts
export function characterWebResearchRequestContent(
  content: string,
  reason: string,
  presentation: CharacterWebResearchPresentation,
): string {
  if (presentation === "quiet") return "";
  return content.trim() ? content : reason.trim();
}
```

Parse chat metadata in `buildMainToolDefinitions` and return:

```ts
characterWebResearchPresentation:
  characterWebResearchPresentation(metadata),
```

Add a focused `tools-runtime.main.spec.ts` assertion that missing metadata resolves to `quiet` and explicit `visible` is retained.

- [ ] **Step 4: Buffer and classify each model turn**

In `runMainToolLoop`, collect token and thinking events for a turn when `mainTools.characterWebResearchPresentation === "quiet"` and character web tools are present. After the provider stream ends:

```ts
const hasCharacterWebCall = pendingToolCalls.some((call) =>
  isCharacterWebToolName(call.function?.name || call.name || ""),
);
const hideTurn = quietResearch && hasCharacterWebCall;
```

When `hideTurn`:

- do not yield deferred token or thinking events;
- do not append `turnContent` or `turnThinking` to persisted assistant content/thinking;
- keep `turnContent` in the tool-protocol assistant message so the model can continue coherently;
- keep `inFlightTurn` empty so an aborted hidden turn is not recovered into the visible message.

When no character web call occurs, flush the deferred events and commit the final answer. Pass presentation to `characterWebResearchRequestContent` so quiet consent requests persist only the approval card metadata.

- [ ] **Step 5: Add a focused public generation regression**

Create `start-generation.web-research-presentation.spec.ts` using `startGeneration`, an in-memory `StorageGateway`, a scripted `LlmGateway.stream`, and a fake `IntegrationGateway.webResearch`. Script these provider turns:

1. an intermediate token plus `request_character_web_research`;
2. an intermediate token plus `search_character_web`;
3. a final no-tool answer.

The scripted stream should return tool calls according to invocation count:

```ts
async *stream() {
  const turn = turns.shift();
  if (!turn) throw new Error("unexpected extra model turn");
  if (turn.text) yield { type: "token", text: turn.text };
  if (turn.toolCall) yield { type: "tool_call", data: turn.toolCall };
}
```

Collect `GenerationEvent`s and assert quiet token events join to `"Final sourced answer."`, contain neither intermediate phrase, and persist only the final answer. Run the same harness with `visible` and assert its narration is retained. Keep this focused test near the generation owner and avoid a browser fixture.

- [ ] **Step 6: Run focused engine tests**

Run:

```bash
pnpm vitest run src/engine/generation/web-research-presentation.spec.ts \
  src/engine/generation/character-web-research.spec.ts \
  src/engine/generation/tools-runtime.main.spec.ts \
  src/engine/generation/start-generation.web-research-presentation.spec.ts
pnpm typecheck
```

Expected: presentation and existing grant tests pass; TypeScript is clean.

- [ ] **Step 7: Commit**

```bash
git add src/engine/contracts/types/chat.ts \
  src/engine/generation/web-research-presentation.ts \
  src/engine/generation/web-research-presentation.spec.ts \
  src/engine/generation/character-web-research.ts \
  src/engine/generation/character-web-research.spec.ts \
  src/engine/generation/start-generation.ts \
  src/engine/generation/start-generation.web-research-presentation.spec.ts \
  src/engine/generation/tools-runtime.ts \
  src/engine/generation/tools-runtime.main.spec.ts
git commit -m "chat: keep character research in the background"
```

---

### Task 4: Organic character research decisions

**Files:**
- Modify: `src/engine/generation/tools-runtime.ts`
- Modify: `src/engine/generation/tools-runtime.main.spec.ts`

**Interfaces:**
- Produces: `MainToolDefinitions.characterWebResearchPresentation`.
- Consumes: `characterWebResearchPresentation(chat.metadata)`.

- [ ] **Step 1: Write failing tool-description tests**

For quiet metadata, assert the request tool description contains:

```ts
expect(description).toContain("Do not wait for the user to say");
expect(description).toContain("current or likely to have changed");
expect(description).toContain("ordinary creative roleplay");
expect(description).toContain("call this tool silently");
```

For visible metadata, assert it permits a brief in-character lead-in and rejects canned boilerplate.

- [ ] **Step 2: Run and confirm red**

Run:

```bash
pnpm vitest run src/engine/generation/tools-runtime.main.spec.ts
```

Expected: the generic current description lacks the organic and presentation-specific guidance.

- [ ] **Step 3: Build the request tool dynamically**

Replace the static request definition with:

```ts
function characterWebResearchRequestTool(
  presentation: CharacterWebResearchPresentation,
): LlmToolDefinition
```

The shared guidance must say:

- use research when information is current, changeable, source-dependent, obscure, or uncertain and would materially improve the reply;
- do not wait for “search the web” or another magic phrase;
- skip ordinary roleplay, opinions, context-supplied facts, and confident timeless knowledge;
- never invent results.

Append:

```ts
presentation === "quiet"
  ? "Call this tool silently. Do not announce, narrate, or describe research. Put the short in-character reason only in the structured reason argument."
  : "A brief natural in-character lead-in is allowed. Never use canned permission boilerplate.";
```

Return presentation from `buildMainToolDefinitions`.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm vitest run src/engine/generation/tools-runtime.main.spec.ts \
  src/engine/generation/character-web-research.spec.ts
pnpm typecheck
```

Expected: both tool presentation variants and existing grant selection pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/generation/tools-runtime.ts \
  src/engine/generation/tools-runtime.main.spec.ts
git commit -m "chat: guide organic character web research"
```

---

### Task 5: Chat setting and collapsed source disclosure

**Files:**
- Modify: `src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.spec.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx`
- Modify: `src/features/shell/settings/lib/settings-information-architecture.spec.ts`
- Modify: `src/features/shell/discovery/discovery-entries.json`

**Interfaces:**
- Persists: `characterWebResearchPresentation: "quiet" | "visible"` in chat metadata.
- Consumes: existing `characterWebResearchSources`.

- [ ] **Step 1: Write failing source disclosure test**

Render sources and assert:

```ts
const disclosure = container.querySelector("details");
expect(disclosure?.open).toBe(false);
expect(screen.getByText("Sources")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "NASA Gateway" })).toHaveAttribute(
  "href",
  "https://www.nasa.gov/gateway/",
);
```

Extend the settings architecture test to require the exact setting label and metadata values.

- [ ] **Step 2: Run and confirm red**

Run:

```bash
pnpm vitest run \
  src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.spec.tsx \
  src/features/shell/settings/lib/settings-information-architecture.spec.ts
```

Expected: sources are not in a `details` disclosure and the setting copy is absent.

- [ ] **Step 3: Implement collapsed sources**

Render:

```tsx
<details className="mt-2 text-xs text-[var(--muted-foreground)]">
  <summary className="cursor-pointer select-none font-medium">Sources</summary>
  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
    {sources.map((source) => (
      <a
        key={source.url}
        className="underline hover:text-[var(--foreground)]"
        href={source.url}
        target="_blank"
        rel="noreferrer"
      >
        {source.title || new URL(source.url).hostname}
      </a>
    ))}
  </div>
</details>
```

Keep `target="_blank"` and `rel="noreferrer"`.

- [ ] **Step 4: Add the background-research setting**

Inside Character Web Research settings, show the toggle whenever web access is enabled:

```ts
const quietResearch = metadata.characterWebResearchPresentation !== "visible";
updateMeta.mutate({
  id: chat.id,
  characterWebResearchPresentation: quietResearch ? "visible" : "quiet",
});
```

Copy:

- Label: `Keep web research in the background`
- Quiet description: `Show only the final answer. Permission prompts still appear when required.`
- Visible description: `Let characters narrate web research while it happens.`

Update discovery metadata to mention natural character decisions, background mode, permanent approval, and collapsed final sources.

- [ ] **Step 5: Run focused UI tests**

Run:

```bash
pnpm vitest run \
  src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.spec.tsx \
  src/features/shell/settings/lib/settings-information-architecture.spec.ts
pnpm typecheck
```

Expected: source and setting tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.tsx \
  src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.spec.tsx \
  src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx \
  src/features/shell/settings/lib/settings-information-architecture.spec.ts \
  src/features/shell/discovery/discovery-entries.json
git commit -m "chat: add immersive research controls"
```

---

### Task 6: Integration, shipping, and Pi acceptance

**Files:**
- Review all files changed by Tasks 1-5.
- Update the design or discovery text only if implementation uncovered a contract mismatch.

**Interfaces:**
- Verifies the complete embedded, hostable, engine, UI, and deployment path.

- [ ] **Step 1: Run architecture and full repository gates**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
pnpm typecheck
pnpm check:architecture
pnpm check
```

Expected: all required gates pass; warning-only existing unused-code output is identified separately.

- [ ] **Step 2: Run local Bunny review**

Run the repo Bunny workflow over the branch diff. Fix all actionable findings and rerun the affected focused tests.

- [ ] **Step 3: Push and open the PR**

Inspect branch, remotes, dirty state, and intended commits. Push only to `origin`, open a draft PR with the repo template, allow CI to complete, run trusted Bunny, resolve findings, and mark ready.

- [ ] **Step 4: Merge after green gates**

Merge only after deterministic repository gates, Rust, Browser Smoke, PR health, and Bunny are green.

- [ ] **Step 5: Deploy the exact merge to the Pi**

Wait for exact merge-SHA server and web images, then run:

```bash
ssh chai@pi 'cd /home/chai/de-koi-src && sh scripts/pi-update.sh --trusted-lan'
```

Verify `origin/main`, both OCI revision labels, `/health?probe=1`, and HTTP 200 all match the merge.

- [ ] **Step 6: Perform literal browser acceptance**

In a cache-busted Pi browser tab:

1. Enable Character Web Research and leave **Keep web research in the background** on.
2. With ask policy, send a naturally phrased current-information question that does not say “search,” click **Allow once**, and verify only the approval card plus final sourced answer appear.
3. Repeat and click **Always allow**.
4. Send another natural current-information question and verify there is no approval card, no interim research narration, and a final sourced answer appears.
5. Verify Sources starts collapsed and expands on a literal click.
6. Confirm server diagnostics identify the serving provider while character dialogue contains no provider or HTTP error details.

- [ ] **Step 7: Report**

Report behavior changed, primary modules, Conversation/Roleplay impact, Deki reuse, Game non-impact, focused/full validation, PR/merge SHA, Bunny/CI status, exact Pi revision, browser-click proof, remaining public-markup risk, and `No vault capture`.
