# Predictive Chat Preload Implementation Plan

**Status:** Implemented and locally verified; live chat-switch timing remains a target-runtime follow-up.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make likely chat switches reuse already-loaded mode code, chat detail, and the first 20 messages while keeping speculative work bounded to three non-active chats.

**Architecture:** The chat catalog will expose the exact TanStack Query option factories used by mounted hooks. The mode router will own reusable dynamic-import loaders, while a shell-local predictor coordinates sequential idle warming, immediate pointer/focus/touch intent, three-slot ownership-aware eviction, and React event wiring without mounting hidden mode surfaces.

**Tech Stack:** React 19, TypeScript, TanStack Query 5, Vitest, Vite dynamic imports

## Global Constraints

- Preserve the dirty primary checkout; work only in `D:\dev\Marinara-Engine\.worktrees\predictive-chat-preload`.
- Owner direction remains `app shell -> modes -> runtime -> catalog`; catalog code must not import mode or shell code.
- Warm only the outer mode surface, the selected concrete mode route, projected chat detail, and the first 20 projected messages.
- Do not preload message counts, memories, lorebooks, galleries, connected chats, scene chats, game state, journals, checkpoints, or mode effects.
- Process idle candidates one at a time and track at most three non-active speculative chat entries.
- Speculative reads use zero retries and no user-facing feedback; mounted hooks retain normal retries and errors.
- Do not add a dependency or a user-visible setting.
- Do not commit unless the execution session has explicit commit/shipping authorization; the commit steps below become stop points otherwise.
- Before adding durable tests, state: `Durable test rationale: query-key reuse, route-loader reuse, and bounded speculative ownership can silently regress while typechecking; existing broad checks do not prove these invariants; the planned tests stay at the narrow query-option, loader-map, and pure-controller boundaries.`

---

### Task 1: Share the mounted chat query definitions

**Files:**
- Create: `src/features/catalog/chats/lib/chat-summary-projection.ts`
- Create: `src/features/catalog/chats/lib/recent-message-content-edits.ts`
- Create: `src/features/catalog/chats/chat-query-options.ts`
- Create: `src/features/catalog/chats/chat-query-options.spec.ts`
- Modify: `src/features/catalog/chats/hooks/use-chats.ts:1-10,268-320`
- Modify: `src/features/catalog/chats/hooks/use-chat-summaries.ts:1-42`
- Modify: `src/features/catalog/chats/sidebar.ts`
- Modify: `src/app/boot-shell-boundary.spec.ts`

**Interfaces:**
- Produces: `chatDetailQueryOptions(chatId: string)`
- Produces: `chatMessagesInfiniteQueryOptions(chatId: string, pageSize?: number)`
- Produces through `sidebar.ts`: the two factories, `chatKeys`, and `ChatListItem`
- Preserves: `useChat(id)` and `useChatMessages(chatId, pageSize, enabled)` public behavior
- Preserves: the startup sidebar must not import the broad `use-chats.ts` hook/mutation bundle

- [ ] **Step 1: State the durable-test rationale, then write the failing query-option tests**

```ts
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Chat, Message } from "../../../engine/contracts/types/chat";
import { chatKeys } from "./query-keys";

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  listChatMessages: vi.fn(),
}));

vi.mock("../../../shared/api/storage-api", () => ({
  storageApi: storageMocks,
}));

import { chatDetailQueryOptions, chatMessagesInfiniteQueryOptions } from "./chat-query-options";

const chat = {
  id: "chat-1",
  name: "Warm chat",
  mode: "conversation",
  characterIds: [],
  groupId: null,
  personaId: null,
  promptPresetId: null,
  connectionId: null,
  connectedChatId: null,
  folderId: null,
  sortOrder: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  metadata: {},
} as Chat;

const message = {
  id: "message-1",
  chatId: "chat-1",
  role: "assistant",
  content: "Ready",
  createdAt: "2026-08-01T00:00:01.000Z",
  extra: {},
} as Message;

describe("chat query options", () => {
  beforeEach(() => {
    storageMocks.get.mockReset();
    storageMocks.listChatMessages.mockReset();
  });

  it("prefetches chat detail into the key consumed by useChat", async () => {
    storageMocks.get.mockResolvedValue(chat);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await queryClient.prefetchQuery(chatDetailQueryOptions("chat-1"));

    expect(storageMocks.get).toHaveBeenCalledWith("chats", "chat-1", expect.objectContaining({ fields: expect.any(Array) }));
    expect(queryClient.getQueryData(chatKeys.detail("chat-1"))).toEqual(chat);
  });

  it("prefetches the projected first 20 messages into the infinite-query shape", async () => {
    storageMocks.listChatMessages.mockResolvedValue([message]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await queryClient.prefetchInfiniteQuery(chatMessagesInfiniteQueryOptions("chat-1", 20));

    expect(storageMocks.listChatMessages).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ limit: 20, fields: expect.arrayContaining(["id", "content", "createdAt"]) }),
    );
    expect(queryClient.getQueryData<InfiniteData<Message[]>>(chatKeys.messages("chat-1"))).toEqual({
      pages: [[message]],
      pageParams: [undefined],
    });
  });
});
```

Extend `src/app/boot-shell-boundary.spec.ts` with this startup-boundary regression (using the file's existing
`currentDir`, `readFileSync`, and `join` helpers):

```ts
it("keeps predictive chat queries out of the broad chat hook bundle", () => {
  const sidebarSource = readFileSync(join(currentDir, "../features/catalog/chats/sidebar.ts"), "utf8");
  const queryOptionsSource = readFileSync(
    join(currentDir, "../features/catalog/chats/chat-query-options.ts"),
    "utf8",
  );

  expect(sidebarSource).toContain('from "./chat-query-options"');
  expect(sidebarSource).not.toContain('from "./hooks/use-chats"');
  expect(queryOptionsSource).not.toContain("hooks/use-chats");
  expect(queryOptionsSource).not.toContain("engine/generation");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run src/features/catalog/chats/chat-query-options.spec.ts src/app/boot-shell-boundary.spec.ts`

Expected: FAIL because the lightweight query module does not exist and `sidebar.ts` has no predictive exports.

- [ ] **Step 3: Extract the exact query option factories and have the hooks consume them**

First extract two neutral catalog helpers so the new query owner stays small:

- Move `CHAT_SUMMARY_FIELDS` and `CHAT_SUMMARY_METADATA_FIELDS`, unchanged, into
  `lib/chat-summary-projection.ts`; import them back into `use-chat-summaries.ts`.
- Move the recent-edit TTL, map, pruning, `rememberRecentMessageContentEdit`,
  `forgetRecentMessageContentEdit`, and `preserveRecentMessageContentEdit` into
  `lib/recent-message-content-edits.ts`; import those functions back into `use-chats.ts`.

Create `chat-query-options.ts`. It may import only TanStack option helpers, storage/error APIs, chat contract
types, query keys, and the lightweight projection/recent-edit/timeline helpers. It must not import React,
`use-chats.ts`, `use-chat-summaries.ts`, `sonner`, or any `engine/generation` module.

Put the following query factories in that new module:

```ts
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import type { Chat, Message } from "../../../engine/contracts/types/chat";
import { ApiError } from "../../../shared/api/api-errors";
import { storageApi } from "../../../shared/api/storage-api";
import { CHAT_SUMMARY_FIELDS } from "./lib/chat-summary-projection";
import { preserveRecentMessageContentEdit } from "./lib/recent-message-content-edits";
import { sanitizeTimelineMessage, timelineMessageProjection } from "./lib/timeline-message";
import { chatKeys } from "./query-keys";

export const DEFAULT_CHAT_MESSAGE_PAGE_SIZE = 20;

export function chatDetailQueryOptions(chatId: string) {
  return queryOptions({
    queryKey: chatKeys.detail(chatId),
    queryFn: () =>
      storageApi.get<Chat>("chats", chatId, { fields: [...CHAT_SUMMARY_FIELDS] }).then((chat) => {
        if (!chat) throw new ApiError("Chat not found", 404);
        return chat;
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function chatMessagesInfiniteQueryOptions(
  chatId: string,
  pageSize: number = DEFAULT_CHAT_MESSAGE_PAGE_SIZE,
) {
  return infiniteQueryOptions({
    queryKey: chatKeys.messages(chatId),
    queryFn: ({ pageParam, signal }) => {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      return storageApi
        .listChatMessages<Message>(chatId, {
          ...timelineMessageProjection({
            ...(pageSize > 0 ? { limit: pageSize } : {}),
            ...(pageParam ? { before: pageParam } : {}),
          }),
        })
        .then((messages) => {
          const rows = messages.map((message) =>
            preserveRecentMessageContentEdit(chatId, sanitizeTimelineMessage(message)),
          );
          return rows;
        });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (pageSize <= 0 || lastPage.length < pageSize) return undefined;
      const oldestLoaded = lastPage[0];
      if (!oldestLoaded) return undefined;
      const createdAt = String(oldestLoaded.createdAt ?? "");
      const id = String(oldestLoaded.id ?? "");
      return id ? `${createdAt}|${id}` : createdAt;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
```

Then import the factories and `DEFAULT_CHAT_MESSAGE_PAGE_SIZE` into `use-chats.ts`, add `useEffect` from React,
and make the mounted hooks consume those exact definitions:

```ts
export function useChat(id: string | null) {
  return useQuery({
    ...chatDetailQueryOptions(id ?? ""),
    enabled: !!id,
  });
}

export function useChatMessages(
  chatId: string | null,
  pageSize: number = DEFAULT_CHAT_MESSAGE_PAGE_SIZE,
  enabled = true,
) {
  const query = useInfiniteQuery({
    ...chatMessagesInfiniteQueryOptions(chatId ?? "", pageSize),
    enabled: !!chatId && enabled,
  });
  const firstPage = query.data?.pages[0];
  useEffect(() => {
    if (!chatId || !firstPage) return;
    markPerformanceMilestoneOnce("chat.message-page.ready", { rowCount: firstPage.length, pageSize });
  }, [chatId, firstPage, pageSize]);
  return query;
}
```

Moving the performance milestone out of the query function is deliberate: a speculative read must not claim
that the active chat is visually ready. The mounted hook still marks the same milestone when it observes page 1.

Add the curated shell-facing exports:

```ts
export { chatKeys } from "./query-keys";
export { chatDetailQueryOptions, chatMessagesInfiniteQueryOptions } from "./chat-query-options";
export type { ChatListItem } from "./hooks/use-chat-summaries";
```

- [ ] **Step 4: Run the focused test and existing chat-hook tests**

Run: `pnpm vitest run src/features/catalog/chats/chat-query-options.spec.ts src/app/boot-shell-boundary.spec.ts src/features/catalog/chats/hooks/use-create-message.spec.ts src/features/catalog/chats/hooks/use-update-message-extra.spec.ts`

Expected: PASS with the new two tests and existing cache/mutation behavior unchanged.

- [ ] **Step 5: Stop for commit authorization**

If authorized:

```powershell
git add src/features/catalog/chats/lib/chat-summary-projection.ts src/features/catalog/chats/lib/recent-message-content-edits.ts src/features/catalog/chats/chat-query-options.ts src/features/catalog/chats/chat-query-options.spec.ts src/features/catalog/chats/hooks/use-chat-summaries.ts src/features/catalog/chats/hooks/use-chats.ts src/features/catalog/chats/sidebar.ts src/app/boot-shell-boundary.spec.ts
git commit -m "Share chat preload query definitions"
```

Otherwise leave the verified changes uncommitted and continue only if the user requested implementation.

---

### Task 2: Reuse the exact mode import promises

**Files:**
- Create: `src/features/modes/router/mode-route-loaders.ts`
- Create: `src/features/modes/router/mode-route-loaders.spec.ts`
- Create: `src/features/modes/router/preload.ts`
- Modify: `src/features/modes/router/components/ModeSurface.tsx:1-22`
- Create: `src/app/shell/mode-surface-loader.ts`
- Modify: `src/app/shell/AppShell.tsx:75-84`
- Modify: `src/app/shell/app-shell-mode-boundary.spec.ts`

**Interfaces:**
- Produces: `MODE_ROUTE_LOADERS`
- Produces: `preloadModeRoute(mode: ChatMode, loaders?: ModeRoutePreloaders): Promise<void>`
- Produces: `loadModeSurface()` for both React `lazy()` and speculative warming

- [ ] **Step 1: Write failing loader-map and shell-boundary tests**

```ts
import { describe, expect, it, vi } from "vitest";
import type { ChatMode } from "../../../engine/contracts/types/chat";
import { preloadModeRoute, type ModeRoutePreloaders } from "./mode-route-loaders";

describe("preloadModeRoute", () => {
  it.each(["conversation", "roleplay", "game"] as const)("loads only the %s route", async (mode: ChatMode) => {
    const loaders: ModeRoutePreloaders = {
      conversation: vi.fn(async () => undefined),
      roleplay: vi.fn(async () => undefined),
      game: vi.fn(async () => undefined),
    };

    await preloadModeRoute(mode, loaders);

    expect(loaders[mode]).toHaveBeenCalledOnce();
    for (const otherMode of ["conversation", "roleplay", "game"] as const) {
      if (otherMode !== mode) expect(loaders[otherMode]).not.toHaveBeenCalled();
    }
  });
});
```

Extend `app-shell-mode-boundary.spec.ts` with a `readModeSurfaceLoaderSource()` helper and:

```ts
it("keeps the mode surface behind the shared dynamic loader", () => {
  const shellSource = readAppShellSource();
  const loaderSource = readModeSurfaceLoaderSource();

  expect(shellSource).toContain("lazy(loadModeSurface)");
  expect(loaderSource).toContain('import("../../features/modes/router/shell")');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm vitest run src/features/modes/router/mode-route-loaders.spec.ts src/app/shell/app-shell-mode-boundary.spec.ts`

Expected: FAIL because the shared loaders do not exist and `AppShell` still owns its inline mode import.

- [ ] **Step 3: Add the mode-router loader registry**

```ts
import type { ChatMode } from "../../../engine/contracts/types/chat";

export const MODE_ROUTE_LOADERS = {
  conversation: async () => {
    const module = await import("../conversation/index");
    return { default: module.ConversationModeRoute };
  },
  roleplay: async () => {
    const module = await import("../roleplay/index");
    return { default: module.RoleplayModeRoute };
  },
  game: async () => {
    const module = await import("../game/index");
    return { default: module.GameModeRoute };
  },
} as const;

export type ModeRoutePreloaders = Record<ChatMode, () => Promise<unknown>>;

export async function preloadModeRoute(
  mode: ChatMode,
  loaders: ModeRoutePreloaders = MODE_ROUTE_LOADERS,
): Promise<void> {
  await loaders[mode]();
}
```

In `ModeSurface.tsx`, import `MODE_ROUTE_LOADERS` and replace the three inline lazy callbacks with:

```ts
const ConversationModeRoute = lazy(MODE_ROUTE_LOADERS.conversation);
const RoleplayModeRoute = lazy(MODE_ROUTE_LOADERS.roleplay);
const GameModeRoute = lazy(MODE_ROUTE_LOADERS.game);
```

Create the preload-only public entrypoint. Do not export this from `shell.ts`, because a static sidebar import of `shell.ts` would eagerly pull `ModeSurface` across the lazy boundary.

```ts
export { preloadModeRoute } from "./mode-route-loaders";
```

- [ ] **Step 4: Add the outer shared mode-surface loader**

```ts
export function loadModeSurface() {
  return import("../../features/modes/router/shell").then((module) => ({ default: module.ModeSurface }));
}
```

In `AppShell.tsx`, import `loadModeSurface` from `./mode-surface-loader` and replace the inline `ModeSurface` lazy callback with:

```ts
const ModeSurface = lazy(loadModeSurface);
```

- [ ] **Step 5: Run loader tests, architecture check, and build**

Run: `pnpm vitest run src/features/modes/router/mode-route-loaders.spec.ts src/app/shell/app-shell-mode-boundary.spec.ts`

Expected: PASS.

Run: `pnpm check:architecture`

Expected: PASS; no catalog-to-mode or private cross-feature import violations.

Run: `pnpm build`

Expected: PASS and the conversation, roleplay, and game routes remain separate lazy chunks.

- [ ] **Step 6: Stop for commit authorization**

If authorized:

```powershell
git add src/features/modes/router src/app/shell/mode-surface-loader.ts src/app/shell/AppShell.tsx src/app/shell/app-shell-mode-boundary.spec.ts
git commit -m "Share predictive mode loaders"
```

---

### Task 3: Build the bounded predictive preload controller

**Files:**
- Create: `src/app/shell/predictive-chat-preload.ts`
- Create: `src/app/shell/predictive-chat-preload.spec.ts`

**Interfaces:**
- Produces: `selectRecentPredictiveChats(chats, activeChatId, limit?)`
- Produces: `createPredictiveChatPreloadController(dependencies, capacity?)`
- Produces: `scheduleIdlePredictiveChatPreloads(candidates, preload, requestIdle?)`
- Produces: `predictiveChatIntentHandlers(chat, preload)`

- [ ] **Step 1: Write failing pure-controller tests**

```ts
import { describe, expect, it, vi } from "vitest";
import type { ChatListItem } from "../../features/catalog/chats/sidebar";
import {
  createPredictiveChatPreloadController,
  predictiveChatIntentHandlers,
  scheduleIdlePredictiveChatPreloads,
  selectRecentPredictiveChats,
  type PredictiveChatPreloadDependencies,
} from "./predictive-chat-preload";

function chat(id: string, updatedAt: string): ChatListItem {
  return { id, name: id, mode: "conversation", characterIds: [], groupId: null, personaId: null,
    promptPresetId: null, connectionId: null, folderId: null, sortOrder: 0, connectedChatId: null,
    createdAt: updatedAt, updatedAt, metadata: {} };
}

function dependencies(): PredictiveChatPreloadDependencies {
  return {
    hasDetail: vi.fn(() => false),
    hasMessages: vi.fn(() => false),
    preloadSurface: vi.fn(async () => undefined),
    preloadRoute: vi.fn(async () => undefined),
    prefetchDetail: vi.fn(async () => undefined),
    prefetchMessages: vi.fn(async () => undefined),
    removeDetail: vi.fn(),
    removeMessages: vi.fn(),
  };
}

describe("predictive chat preload", () => {
  it("selects the three newest non-active chats", () => {
    const selected = selectRecentPredictiveChats(
      [chat("old", "2026-08-01T01:00:00Z"), chat("active", "2026-08-01T04:00:00Z"),
       chat("new", "2026-08-01T03:00:00Z"), chat("middle", "2026-08-01T02:00:00Z"),
       chat("oldest", "2026-08-01T00:00:00Z")],
      "active",
    );
    expect(selected.map((item) => item.id)).toEqual(["new", "middle", "old"]);
  });

  it("evicts only predictor-owned data after a fourth non-active chat", async () => {
    const deps = dependencies();
    const controller = createPredictiveChatPreloadController(deps, 3);
    await controller.preload(chat("one", "2026-08-01T01:00:00Z"));
    await controller.preload(chat("two", "2026-08-01T02:00:00Z"));
    await controller.preload(chat("three", "2026-08-01T03:00:00Z"));
    await controller.preload(chat("four", "2026-08-01T04:00:00Z"));
    expect(deps.removeDetail).toHaveBeenCalledWith("one");
    expect(deps.removeMessages).toHaveBeenCalledWith("one");
    expect(controller.snapshot()).toEqual(["two", "three", "four"]);
  });

  it("transfers an activated chat out of speculative ownership without evicting it", async () => {
    const deps = dependencies();
    const controller = createPredictiveChatPreloadController(deps, 3);
    await controller.preload(chat("one", "2026-08-01T01:00:00Z"));
    controller.setActiveChatId("one");
    await controller.preload(chat("two", "2026-08-01T02:00:00Z"));
    await controller.preload(chat("three", "2026-08-01T03:00:00Z"));
    await controller.preload(chat("four", "2026-08-01T04:00:00Z"));
    expect(deps.removeDetail).not.toHaveBeenCalledWith("one");
    expect(deps.removeMessages).not.toHaveBeenCalledWith("one");
    expect(controller.snapshot()).toEqual(["two", "three", "four"]);
  });

  it("does not remove detail data that existed before prediction", async () => {
    const deps = dependencies();
    vi.mocked(deps.hasDetail).mockImplementation((chatId) => chatId === "one");
    const controller = createPredictiveChatPreloadController(deps, 3);
    await controller.preload(chat("one", "2026-08-01T01:00:00Z"));
    await controller.preload(chat("two", "2026-08-01T02:00:00Z"));
    await controller.preload(chat("three", "2026-08-01T03:00:00Z"));
    await controller.preload(chat("four", "2026-08-01T04:00:00Z"));
    expect(deps.removeDetail).not.toHaveBeenCalledWith("one");
    expect(deps.removeMessages).toHaveBeenCalledWith("one");
  });

  it("deduplicates in-flight intent and resolves speculative failures", async () => {
    const deps = dependencies();
    vi.mocked(deps.prefetchDetail).mockRejectedValue(new Error("offline"));
    vi.mocked(deps.preloadRoute).mockRejectedValue(new Error("chunk unavailable"));
    const controller = createPredictiveChatPreloadController(deps, 3);
    const target = chat("one", "2026-08-01T01:00:00Z");
    const first = controller.preload(target);
    const second = controller.preload(target);
    expect(second).toBe(first);
    await expect(first).resolves.toBeUndefined();
    expect(deps.prefetchDetail).toHaveBeenCalledOnce();
    expect(deps.preloadRoute).toHaveBeenCalledOnce();
  });

  it("runs idle candidates sequentially", async () => {
    const callbacks: Array<() => void> = [];
    let releaseFirst!: () => void;
    const preload = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValue(undefined);
    scheduleIdlePredictiveChatPreloads(
      [chat("one", "2026-08-01T01:00:00Z"), chat("two", "2026-08-01T02:00:00Z")],
      preload,
      (callback) => { callbacks.push(callback); return () => undefined; },
    );
    callbacks.shift()?.();
    expect(preload).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(0);
    releaseFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks).toHaveLength(1);
  });

  it("maps pointer, focus, and touch-compatible pointer-down intent to one preload callback", () => {
    const preload = vi.fn();
    const target = chat("one", "2026-08-01T01:00:00Z");
    const handlers = predictiveChatIntentHandlers(target, preload);
    handlers.onPointerEnter();
    handlers.onFocus();
    handlers.onPointerDown();
    expect(preload).toHaveBeenCalledTimes(3);
    expect(preload).toHaveBeenNthCalledWith(1, target);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run src/app/shell/predictive-chat-preload.spec.ts`

Expected: FAIL because the controller module does not exist.

- [ ] **Step 3: Implement the pure predictor and sequential idle scheduler**

```ts
import type { ChatListItem } from "../../features/catalog/chats/sidebar";

export type PredictiveChatCandidate = Pick<ChatListItem, "id" | "mode" | "updatedAt">;
export type PredictiveIdleRequest = (callback: () => void) => () => void;

export interface PredictiveChatPreloadDependencies {
  hasDetail(chatId: string): boolean;
  hasMessages(chatId: string): boolean;
  preloadSurface(): Promise<unknown>;
  preloadRoute(mode: PredictiveChatCandidate["mode"]): Promise<unknown>;
  prefetchDetail(chatId: string): Promise<unknown>;
  prefetchMessages(chatId: string): Promise<unknown>;
  removeDetail(chatId: string): void;
  removeMessages(chatId: string): void;
}

type SpeculativeEntry = { id: string; ownsDetail: boolean; ownsMessages: boolean };

export function selectRecentPredictiveChats(
  chats: readonly ChatListItem[],
  activeChatId: string | null,
  limit = 3,
): PredictiveChatCandidate[] {
  return [...chats]
    .filter((chat) => chat.id !== activeChatId)
    .sort((left, right) => {
      const timeDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return timeDifference || left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(0, limit));
}

export function createPredictiveChatPreloadController(
  dependencies: PredictiveChatPreloadDependencies,
  capacity = 3,
) {
  let activeChatId: string | null = null;
  const entries: SpeculativeEntry[] = [];
  const inFlight = new Map<string, Promise<void>>();

  function evictOverflow() {
    while (entries.length > capacity) {
      const evicted = entries.shift();
      if (!evicted) return;
      if (evicted.ownsDetail) dependencies.removeDetail(evicted.id);
      if (evicted.ownsMessages) dependencies.removeMessages(evicted.id);
    }
  }

  function promote(chatId: string): SpeculativeEntry {
    const existingIndex = entries.findIndex((entry) => entry.id === chatId);
    const existing = existingIndex >= 0 ? entries.splice(existingIndex, 1)[0] : undefined;
    const entry = existing ?? {
      id: chatId,
      ownsDetail: !dependencies.hasDetail(chatId),
      ownsMessages: !dependencies.hasMessages(chatId),
    };
    entries.push(entry);
    evictOverflow();
    return entry;
  }

  return {
    setActiveChatId(chatId: string | null) {
      activeChatId = chatId;
      if (!chatId) return;
      const index = entries.findIndex((entry) => entry.id === chatId);
      if (index >= 0) entries.splice(index, 1);
    },
    preload(chat: PredictiveChatCandidate): Promise<void> {
      if (chat.id === activeChatId) return Promise.resolve();
      promote(chat.id);
      const existing = inFlight.get(chat.id);
      if (existing) return existing;
      const request = Promise.allSettled([
        dependencies.preloadSurface(),
        dependencies.preloadRoute(chat.mode),
        dependencies.prefetchDetail(chat.id),
        dependencies.prefetchMessages(chat.id),
      ])
        .then(() => undefined)
        .finally(() => inFlight.delete(chat.id));
      inFlight.set(chat.id, request);
      return request;
    },
    snapshot: () => entries.map((entry) => entry.id),
  };
}

export function requestPredictiveChatIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 1_800 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 1_200);
  return () => window.clearTimeout(id);
}

export function scheduleIdlePredictiveChatPreloads(
  candidates: readonly PredictiveChatCandidate[],
  preload: (chat: PredictiveChatCandidate) => Promise<void>,
  requestIdle: PredictiveIdleRequest = requestPredictiveChatIdle,
): () => void {
  const queue = [...candidates];
  let cancelled = false;
  let cancelScheduled = () => undefined;
  const scheduleNext = () => {
    if (cancelled || queue.length === 0) return;
    cancelScheduled = requestIdle(() => {
      if (cancelled) return;
      const next = queue.shift();
      if (!next) return;
      void preload(next).catch(() => undefined).finally(scheduleNext);
    });
  };
  scheduleNext();
  return () => {
    cancelled = true;
    cancelScheduled();
  };
}

export function predictiveChatIntentHandlers(
  chat: PredictiveChatCandidate,
  preload: (chat: PredictiveChatCandidate) => void,
) {
  const onIntent = () => preload(chat);
  return { onPointerEnter: onIntent, onFocus: onIntent, onPointerDown: onIntent };
}
```

- [ ] **Step 4: Run the pure tests and verify GREEN**

Run: `pnpm vitest run src/app/shell/predictive-chat-preload.spec.ts`

Expected: PASS with seven controller/scheduler/intent tests.

- [ ] **Step 5: Stop for commit authorization**

If authorized:

```powershell
git add src/app/shell/predictive-chat-preload.ts src/app/shell/predictive-chat-preload.spec.ts
git commit -m "Add bounded chat preload controller"
```

---

### Task 4: Bind the predictor to TanStack Query and sidebar intent

**Files:**
- Create: `src/app/shell/use-predictive-chat-preload.ts`
- Modify: `src/app/shell/ChatSidebar.tsx:1-70,240-300,887-930`

**Interfaces:**
- Consumes: Task 1 query factories and keys
- Consumes: Task 2 `loadModeSurface` and `preloadModeRoute`
- Consumes: Task 3 controller, selector, idle scheduler, and intent handlers
- Produces: `usePredictiveChatPreload({ chats, activeChatId })`

- [ ] **Step 1: Create the React/query adapter**

```ts
import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  chatDetailQueryOptions,
  chatKeys,
  chatMessagesInfiniteQueryOptions,
  type ChatListItem,
} from "../../features/catalog/chats/sidebar";
import { preloadModeRoute } from "../../features/modes/router/preload";
import { loadModeSurface } from "./mode-surface-loader";
import {
  createPredictiveChatPreloadController,
  scheduleIdlePredictiveChatPreloads,
  selectRecentPredictiveChats,
  type PredictiveChatCandidate,
} from "./predictive-chat-preload";

const PREDICTIVE_MESSAGE_PAGE_SIZE = 20;

export function usePredictiveChatPreload({
  chats,
  activeChatId,
}: {
  chats: readonly ChatListItem[];
  activeChatId: string | null;
}) {
  const queryClient = useQueryClient();
  const controller = useMemo(
    () =>
      createPredictiveChatPreloadController({
        hasDetail: (chatId) => queryClient.getQueryData(chatKeys.detail(chatId)) !== undefined,
        hasMessages: (chatId) => queryClient.getQueryData(chatKeys.messages(chatId)) !== undefined,
        preloadSurface: loadModeSurface,
        preloadRoute: preloadModeRoute,
        prefetchDetail: (chatId) =>
          queryClient.prefetchQuery({ ...chatDetailQueryOptions(chatId), retry: false }),
        prefetchMessages: (chatId) =>
          queryClient.prefetchInfiniteQuery({
            ...chatMessagesInfiniteQueryOptions(chatId, PREDICTIVE_MESSAGE_PAGE_SIZE),
            retry: false,
          }),
        removeDetail: (chatId) => queryClient.removeQueries({ queryKey: chatKeys.detail(chatId), exact: true }),
        removeMessages: (chatId) => queryClient.removeQueries({ queryKey: chatKeys.messages(chatId), exact: true }),
      }),
    [queryClient],
  );

  useEffect(() => controller.setActiveChatId(activeChatId), [activeChatId, controller]);

  const recentCandidates = useMemo(
    () => selectRecentPredictiveChats(chats, activeChatId),
    [activeChatId, chats],
  );
  const preload = useCallback((chat: PredictiveChatCandidate) => controller.preload(chat), [controller]);

  useEffect(
    () => scheduleIdlePredictiveChatPreloads(recentCandidates, preload),
    [preload, recentCandidates],
  );

  return useCallback((chat: PredictiveChatCandidate) => void preload(chat), [preload]);
}
```

- [ ] **Step 2: Wire the hook and all three intent events into `ChatSidebar`**

Add imports:

```ts
import { usePredictiveChatPreload } from "./use-predictive-chat-preload";
import { predictiveChatIntentHandlers } from "./predictive-chat-preload";
```

After reading `activeChatId`, initialize:

```ts
const requestChatPreload = usePredictiveChatPreload({ chats: chats ?? [], activeChatId });
```

On the outer chat-row `<div>`, add:

```tsx
{...(!multiSelectMode ? predictiveChatIntentHandlers(chat, requestChatPreload) : {})}
```

Keep this spread beside the existing `data-chat-id`, drag, and click handlers. Do not move navigation or confirmation logic into the predictor.

- [ ] **Step 3: Run the focused preload, sidebar, and mode tests**

Run:

```powershell
pnpm vitest run src/features/catalog/chats/chat-query-options.spec.ts src/app/boot-shell-boundary.spec.ts src/features/modes/router/mode-route-loaders.spec.ts src/app/shell/predictive-chat-preload.spec.ts src/app/shell/app-shell-mode-boundary.spec.ts src/app/shell/chat-sidebar-virtual-list.spec.tsx src/app/shell/chat-sidebar-rows.spec.ts
```

Expected: PASS; no preload test emits a toast, activates a chat, or mounts a mode surface.

- [ ] **Step 4: Run matching lane checks**

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm check:architecture`

Expected: PASS.

Run: `pnpm build`

Expected: PASS with separate lazy route chunks.

Run: `pnpm perf:size`

Expected: PASS without exceeding startup or total bundle budgets.

- [ ] **Step 5: Stop for commit authorization**

If authorized:

```powershell
git add src/app/shell/use-predictive-chat-preload.ts src/app/shell/ChatSidebar.tsx
git commit -m "Preload likely chats before selection"
```

---

### Task 5: Verify real browser behavior and final scope

**Files:**
- Review only: all files changed in Tasks 1-4
- Update only if evidence requires it: `docs/superpowers/specs/2026-08-01-predictive-chat-preload-design.md`

**Interfaces:**
- Proves: warmed selection reuses code/data without hidden mode execution
- Proves: cold/failure paths retain current behavior

- [ ] **Step 1: Start the app with performance diagnostics enabled**

Run: `pnpm dev --host 127.0.0.1`

In the browser console, set `localStorage.deKoiPerformanceDiagnostics = "1"`, reload once, and keep Network filtered to mode chunks plus storage `/api/invoke` traffic when using the remote runtime.

- [ ] **Step 2: Verify idle warming**

Wait until the browser is idle. Confirm the three newest non-active chats request their outer/concrete mode chunks and their detail/first-message-page reads before any click. Confirm requests are sequential rather than a six-read burst.

- [ ] **Step 3: Verify intent warming and bounded replacement**

Hover or keyboard-focus an older visible chat. Confirm its warm requests start immediately. Repeat with enough older chats to exceed three, then select the oldest evicted candidate and confirm its detail/message read is cold again while the previously active chat was not evicted.

- [ ] **Step 4: Verify click-time reuse and failure isolation**

Click a warmed chat within the 60-second stale window. Confirm no duplicate detail or first-page message read occurs and no hidden mode effect ran before selection. Then click a cold chat and confirm the existing `Opening chat...` behavior remains intact. Failure isolation remains covered by the pure controller/query tests rather than disrupting the configured runtime.

- [ ] **Step 5: Run the integrated local gate**

Run: `pnpm check`

Expected: PASS. If discovery asks for metadata, document `Feature Discoverability: N/A` because this changes automatic navigation responsiveness without adding a discoverable user control.

- [ ] **Step 6: Review final diff and report evidence**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Report separately:

- measured browser cold-versus-warm selection behavior;
- build/bundle evidence;
- any target-Pi timing gap;
- impact area: app shell, chat catalog query definitions, mode router loaders;
- dependent areas reviewed: conversation, roleplay, game, remote runtime storage reads;
- vault receipt: `No vault capture` unless vault files were explicitly changed.

- [ ] **Step 7: Stop for final commit or shipping authorization**

Do not commit, push, open a PR, run Bunny, merge, or update the Pi unless the user explicitly authorizes that next lane.
