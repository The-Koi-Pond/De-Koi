# Character Web Research Resilience and Immersion

Date: 2026-07-19

## Goal

Make De-Koi's consent-gated web research reliable enough for normal character use and quiet enough that it does not break immersion.

The finished behavior must:

1. Continue searching through an independent provider when Brave is throttled, unavailable, or returns unusable results.
2. Let each chat keep research activity in the background while preserving required consent and final citations.
3. Give characters enough guidance to choose web research naturally when it would materially improve a reply, without requiring a magic phrase from the user.

## Non-goals

- Removing the consent boundary or widening a grant beyond its approved query and domains.
- Hiding final source attribution completely.
- Adding required third-party accounts, API keys, or paid services.
- Turning every factual question into a web search.
- Exposing provider names, retries, or transport errors in character dialogue.
- Changing Game mode ownership or enabling character web research in modes that do not already support it.

## Architecture

### Shared hostable search capability

The embedded Tauri and hostable HTTP paths will continue to enter through their existing commands. Search transport and parsing will move behind one shared Rust capability used by both character research and Deki-senpai.

The capability will expose a provider-neutral result:

```text
WebSearchResult {
  title
  url
  snippet
}
```

Provider adapters will initially support:

1. Brave web results.
2. Bing web results.

The caller supplies the already validated effective query and result limit. The shared capability does not own consent, chat metadata, domain authorization, or page reads. Character and Deki owners retain those checks before and after search.

This avoids duplicating provider behavior while preserving the existing command and security boundaries:

```text
Chat or Deki request
  -> existing consent/grant validation
  -> shared provider-neutral search capability
  -> existing allowed-domain and public-URL filtering
  -> provider-neutral results returned to the model
```

### Provider fallback and cooldown

Search tries available providers sequentially. A provider is skipped for the current search when it returns:

- HTTP 429
- HTTP 5xx
- a request timeout or transport failure
- malformed or unrecognized result markup
- zero usable results

The next provider is tried immediately. A short in-process cooldown prevents subsequent tool calls from repeatedly hitting a provider that just returned 429. Successful searches clear that provider's transient failure state.

Provider failures are retained for diagnostics and tests, but the model receives either usable results or one provider-neutral exhausted error after every provider fails. De-Koi must not claim successful research without results.

## Immersive presentation

Chat metadata gains:

```text
characterWebResearchPresentation: "quiet" | "visible"
```

Missing metadata defaults to `quiet`.

Chat Settings shows a toggle named **Keep web research in the background**. Its description states that De-Koi will show only the final response and that permission prompts still appear when required.

### Quiet mode

- If the chat policy is `ask`, the approval card remains visible because consent is required.
- The request message itself does not show or persist the model's research narration. The approval card still displays the model-authored in-character reason and exact query.
- If the chat policy is `always`, no approval card is shown.
- Text emitted during request, search, page-read, retry, and other web-tool iterations is buffered rather than streamed to the visible message.
- Intermediate text from iterations that invoke character web tools is discarded from the persisted assistant message.
- The final no-tool answer is revealed after that model turn completes.
- Provider names and transport errors are never turned into visible research-process prose by De-Koi.

### Visible mode

Visible mode preserves the current ability for a character to narrate their research in character. Approval behavior remains unchanged.

### Sources

Final source links remain attached to the final assistant message in both presentation modes. They render as a collapsed **Sources** disclosure by default and expand on user action. Source links remain ordinary external links with the current safety attributes.

## Character decision guidance

The request tool description will explicitly tell the model to use judgment rather than wait for a command.

Research is appropriate when:

- the information is current or likely to have changed;
- a source-backed canon, rule, product, event, or real-world fact would materially improve the reply;
- the fact is obscure or uncertain enough that guessing would weaken the character's response;
- the user naturally asks about something the character would plausibly look up or verify.

Research is not appropriate for:

- ordinary creative roleplay;
- opinions or emotional reactions;
- facts already supplied in the conversation or active context;
- timeless facts the model can answer confidently;
- searches that would not materially change the response.

The tool guidance will explicitly say not to wait for phrases such as “search the web.” It will also adapt to presentation:

- `quiet`: call the tool without announcing, narrating, or describing the process; provide the in-character reason only in the structured tool argument used by the approval card.
- `visible`: a brief character-authentic lead-in is allowed, but canned boilerplate is forbidden.

The model still chooses whether to request research. De-Koi does not add keyword-triggered automatic searches.

## Error behavior

- One provider failure is invisible when another provider succeeds.
- If every provider fails, the tool returns a typed provider-neutral failure to the model.
- Quiet mode asks the model to answer without inventing search results and without reciting transport details.
- Visible mode may acknowledge that information could not be verified, but must remain in character and must not expose raw HTTP errors.
- Approval grants remain scoped to the exact query, chat, domains, and expiry.
- A search fallback cannot widen allowed domains or bypass public-host validation.

## Ownership and mode impact

- Rust provider capability: privileged and hostable web-search transport.
- TypeScript engine: presentation policy, tool guidance, and stream/persistence decisions.
- Shared chat UI: chat setting and collapsed source disclosure.
- Conversation and Roleplay continue to consume the shared chat UI and generation engine.
- Game mode is unchanged.
- Deki-senpai reuses the provider capability but keeps its own consent UI, agent prompt, and result handling.

## Testing

### Rust

- Brave fixture parsing.
- Bing fixture parsing.
- A mocked Brave 429 immediately falls through to Bing.
- Timeouts, 5xx, malformed markup, and empty results fall through.
- Provider cooldown skips a recently throttled provider.
- Exhaustion returns one provider-neutral error.
- Existing exact-query, allowed-domain, public-host, and page-read security tests remain green.
- Both character and Deki entrypoints use the shared search capability.

### TypeScript engine

- Missing presentation metadata resolves to `quiet`.
- Quiet request turns do not emit or persist intermediate character narration.
- Quiet search/read/retry turns stay hidden.
- The final no-tool character answer is retained.
- Visible mode preserves narration.
- Tool guidance includes positive research criteria, negative criteria, no-magic-phrase guidance, and presentation-specific instructions.
- Ask and always-allow grants retain their existing behavior.

### UI

- Chat Settings toggles quiet and visible presentation.
- Required approval cards remain actionable in quiet mode.
- The request reason remains on the approval card while narration stays hidden.
- Sources are collapsed by default and expand on click.
- Conversation and Roleplay message renderers behave consistently.

### Shipping and live proof

- Run focused Rust, engine, and component tests.
- Run `cargo check --manifest-path src-tauri/Cargo.toml`.
- Run `pnpm typecheck`, `pnpm check:architecture`, and full `pnpm check`.
- Complete Bunny review and repository CI before merge.
- Deploy the exact merged revision to the Pi.
- In the Pi browser:
  1. Verify quiet mode plus **Allow once** reaches a sourced final answer without interim narration.
  2. Verify quiet mode plus **Always allow** reaches a sourced final answer.
  3. Send a fresh naturally phrased current-information message without “search the web” and verify the character elects to research.
  4. Verify permanent approval suppresses the approval card.
  5. Verify the Sources disclosure is collapsed and expands when clicked.
  6. Inspect server diagnostics to confirm which provider served the search without exposing it in character dialogue.

## Rollout and remaining risk

No migration is required because missing presentation metadata has a defined default.

The main remaining risk is markup drift in public search result pages. Keeping providers behind small adapters, testing representative fixtures, and falling through on malformed or empty output contains that risk. A future configured official API or self-hosted SearXNG adapter can be added without changing consent, generation, or UI contracts.
