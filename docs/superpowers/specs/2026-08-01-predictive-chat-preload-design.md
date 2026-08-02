# Predictive Chat Preload Design

**Status:** Implemented and locally verified
**Scope:** Chat navigation responsiveness in the De-Koi shell

## Goal

Make switching chats feel immediate by warming the likely next chat before selection. The feature must reduce click-to-visible-chat delay without activating hidden chats, running mode effects, or creating unbounded background traffic.

## User-visible behavior

- After chat summaries are ready, De-Koi waits for browser idle time and warms the three most recently updated non-active chats.
- Hovering a chat, focusing it with the keyboard, or pressing it on a touch device immediately promotes that chat into the three-slot warm set.
- Selecting a warmed chat reuses the prefetched mode code, chat record, and first 20 messages.
- A cold or failed preload follows the existing click-time loading and error behavior. Speculative failures do not show toasts or change the active chat.

## Approaches considered

### Recent-only idle warming

Warm the three most recent chats after startup. This is simple and helps mobile, but an older chat the user clearly targets remains cold.

### Recent plus intent warming

Warm three recent chats while idle, then let hover, focus, or touch replace the least-recent speculative slot. This covers mobile, keyboard, and pointer navigation while keeping the data budget bounded.

**Selected:** Recent plus intent warming.

### Hidden rendered chat surfaces

Mount likely chats offscreen so all hooks and components initialize. This could hide more latency, but it would consume substantially more memory and risks running chat, game, or roleplay effects for a chat the user never opened. This approach is rejected.

## Architecture

### Shell orchestration

A focused hook under `src/app/shell` owns scheduling and the three-slot speculative least-recently-used set. `ChatSidebar` supplies current summaries, active chat ID, and row intent events; it does not own storage query definitions or mode import details.

The idle queue processes one chat at a time to avoid a six-request startup burst on the Pi or remote runtime. Intent-driven warming jumps ahead of the idle queue and starts immediately. Unmounting cancels scheduled idle work but does not cancel an already useful read.

### Shared chat query definitions

The chat catalog exposes shared TanStack Query option factories for:

- the projected chat detail record;
- the first 20-message infinite-query page.

The existing `useChat` and `useChatMessages` hooks and the speculative warmer consume the same factories. This guarantees identical keys, projections, stale times, pagination shape, sanitization, and recent-edit preservation. The warmer overrides retries to zero so a speculative read cannot create background retry churn; normal mounted hooks retain their existing retry and user-facing error behavior.

### Shared mode loaders

Mode imports move behind stable loader functions used by both React `lazy()` and the predictive warmer:

- the outer `ModeSurface` loader;
- conversation, roleplay, and game route loaders.

Calling a loader warms the same browser module promise later consumed by `lazy()`. No hidden React tree is mounted.

### Character data

No additional character request is required. `ChatSidebar` already loads the chat-surface character summaries for the union of sidebar character IDs, so the data needed by the selected chat is normally warm before prediction begins.

## Resource budget and eviction

- At most three non-active chat detail/message pairs are tracked as speculative.
- Adding a fourth candidate evicts the oldest speculative detail and message queries, unless that chat has become active.
- Active-chat cache entries are never removed by the predictor.
- Mode code is not manually evicted; there are only three top-level mode routes and browser module loading is naturally deduplicated.
- The predictor does not preload message counts, memories, lorebooks, galleries, connected chats, scene chats, game state, journals, checkpoints, or other mode-specific secondary data.

## Failure and concurrency behavior

- Module and data warming run independently so one failure does not discard successful work.
- Speculative failures produce no toast and do not mutate navigation state.
- TanStack Query deduplicates a click that races an in-flight preload.
- Repeated intent for the same chat reuses the in-flight or fresh cache entry.
- A real click remains authoritative: mounted hooks retry and surface their normal loading or error state.

## Testing

Durable focused tests will cover these easy-to-regress invariants:

1. Recent candidates are ordered by `updatedAt`, exclude the active chat, and stop at three.
2. Hover/focus/touch intent promotes a chat and evicts the oldest eligible speculative slot.
3. The active chat is never evicted.
4. Prefetch writes the exact detail and first-page query keys and shapes consumed by the mounted hooks.
5. The message preload requests 20 projected messages.
6. Each chat mode invokes the matching shared route loader.
7. A speculative failure does not change the active chat or emit user-facing feedback.

Matching validation is focused Vitest first, then `pnpm typecheck`, `pnpm check:architecture`, and `pnpm build` because this changes React query ownership and lazy-import boundaries.

## Runtime proof

Browser verification will compare a cold chat with an idle- or intent-warmed chat and confirm:

- the warm chat's mode chunks load before click;
- selection reuses cached detail and first-page messages rather than issuing duplicate reads within the stale window;
- no hidden mode surface or mode effect runs before selection;
- cold-chat and preload-failure behavior remains unchanged.

Any target-Pi speed claim requires a separate Pi/browser timing run. Build output and hosted browser checks alone are not target-device latency proof.

## Non-goals

- Precomputing prompt context.
- Preloading full chat history or secondary panels.
- Changing the current 20-message paging or 160-message render window.
- Changing generation, storage, or provider behavior.
- Adding a user-visible setting for the initial release.
