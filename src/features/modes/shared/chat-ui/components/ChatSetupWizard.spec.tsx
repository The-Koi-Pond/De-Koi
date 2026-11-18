import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "../../../../../shared/components/ui/Modal";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { ChatSetupWizard } from "./ChatSetupWizard";

const mocks = vi.hoisted(() => ({
  applyChatPreset: vi.fn(async (_input: unknown) => undefined),
  applyPendingProfile: vi.fn(async () => true),
  addSwipe: vi.fn(async (..._args: unknown[]) => ({})),
  cards: {} as Record<string, unknown>,
  characters: [] as Array<Record<string, unknown>>,
  chatPresets: [] as Array<Record<string, unknown>>,
  connections: [] as Array<Record<string, unknown>>,
  createCharacter: vi.fn(async (_input?: unknown) => ({ id: "character-new" })),
  createMessage: vi.fn(async (_input: unknown) => ({ id: "greeting-1" })),
  deleteMessage: vi.fn(async (_id: string) => ({ deleted: 1 })),
  generateSchedules: vi.fn(async (..._args: unknown[]) => ({ results: {} })),
  lorebooks: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  personas: [] as Array<Record<string, unknown>>,
  presetFull: { data: undefined as unknown, isLoading: false },
  promptPresets: [] as Array<Record<string, unknown>>,
  refreshStatus: vi.fn(async (..._args: unknown[]) => ({ refreshed: [] as string[], skipped: [] as string[] })),
  toastError: vi.fn(),
  updateChat: vi.fn(),
  updateChatAsync: vi.fn(async (_input: unknown) => ({})),
  updateMetadata: vi.fn(),
  updateMetadataAsync: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));

vi.mock("../../../../../shared/api/storage-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../shared/api/storage-api")>();
  return {
    ...actual,
    storageApi: {
      ...actual.storageApi,
      get: vi.fn(async (_entity: string, id: string) => mocks.cards[id] ?? null),
      addChatMessageSwipe: mocks.addSwipe,
    },
  };
});

vi.mock("../../../../../engine/modes/chat/schedules/schedule.service", () => ({
  generateConversationSchedules: mocks.generateSchedules,
}));

vi.mock("../../../../../engine/modes/chat/status/status-message.service", () => ({
  maybeRefreshConversationStatusMessages: mocks.refreshStatus,
}));

vi.mock("../../../../catalog/chats/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/chats/index")>();
  return {
    ...actual,
    useChatMessages: () => ({ data: { pages: [mocks.messages], pageParams: [undefined] } }),
    useCreateMessage: () => ({ mutateAsync: mocks.createMessage }),
    useDeleteMessage: () => ({ mutateAsync: mocks.deleteMessage }),
    useUpdateChat: () => ({ isPending: false, mutate: mocks.updateChat, mutateAsync: mocks.updateChatAsync }),
    useUpdateChatMetadata: () => ({ mutate: mocks.updateMetadata, mutateAsync: mocks.updateMetadataAsync }),
  };
});

vi.mock("../../../../catalog/characters/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/characters/index")>();
  return {
    ...actual,
    useCharacterSummaries: () => ({ data: mocks.characters, isError: false, isFetching: false }),
    useCharacterSummariesByIds: () => ({ data: [], isLoading: false, isFetching: false }),
    useCreateCharacter: () => ({ isPending: false, mutateAsync: mocks.createCharacter }),
    // Saving the starter's bundled pictures is the hook's own job; setup only needs the new card's id.
    useAddStarterCharacter: () => ({
      isPending: false,
      add: async (starter: Parameters<typeof actual.starterCharacterCreateInput>[0]) => {
        const result = await mocks.createCharacter(actual.starterCharacterCreateInput(starter));
        return { id: result.id, artError: null };
      },
    }),
  };
});

vi.mock("../../../../catalog/personas/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/personas/index")>();
  return { ...actual, usePersonaSummaries: () => ({ data: mocks.personas, isLoading: false }) };
});

vi.mock("../../../../catalog/connections/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/connections/index")>();
  return { ...actual, useConnections: () => ({ data: mocks.connections, isLoading: false }) };
});

vi.mock("../../../../catalog/lorebooks/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/lorebooks/index")>();
  return { ...actual, useLorebooks: () => ({ data: mocks.lorebooks }) };
});

vi.mock("../../../../catalog/presets/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/presets/index")>();
  return {
    ...actual,
    usePresetSummaries: () => ({ data: mocks.promptPresets }),
    useDefaultPresetSummary: () => ({ data: mocks.promptPresets.find((preset) => preset.isDefault) ?? null }),
    usePresetFull: (id: string | null) => (id ? mocks.presetFull : { data: undefined, isLoading: false }),
    ChoiceSelectionModal: ({ onClose }: { onClose: () => void }) => (
      <div role="dialog" aria-label="Story options">
        <button onClick={onClose}>Close story options</button>
      </div>
    ),
  };
});

vi.mock("../../../../catalog/chat-presets/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/chat-presets/index")>();
  return {
    ...actual,
    RoleplayWorkflowProfileChooser: ({
      onNavigateAway,
      onPendingApplyChange,
    }: {
      onNavigateAway?: () => void;
      onPendingApplyChange?: (applyPending: (() => Promise<boolean>) | null) => void;
    }) => (
      <>
        <button onClick={onNavigateAway}>Open workflow destination</button>
        <button onClick={() => onPendingApplyChange?.(mocks.applyPendingProfile)}>Pick workflow profile</button>
      </>
    ),
    useApplyChatPreset: () => ({ mutateAsync: mocks.applyChatPreset }),
    useChatPresets: () => ({ data: mocks.chatPresets }),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface SetupFixture {
  cancel: ReturnType<typeof vi.fn>;
  container: HTMLDivElement;
  finish: ReturnType<typeof vi.fn>;
  queryClient: QueryClient;
  rerender: (chatId: string) => void;
  root: Root;
}

const fixtures: SetupFixture[] = [];

function renderSetup(
  mode: "conversation" | "roleplay",
  { metadata = {}, chat = {} }: { metadata?: Record<string, unknown>; chat?: Record<string, unknown> } = {},
): SetupFixture {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const finish = vi.fn();
  const cancel = vi.fn();
  const name = mode === "conversation" ? "New Conversation" : "New Roleplay";

  const rerender = (chatId: string) => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatSetupWizard
            chat={{ id: chatId, mode, name, characterIds: [], metadata: JSON.stringify(metadata), ...chat } as never}
            onFinish={finish}
            onCancel={cancel}
          />
        </QueryClientProvider>,
      );
    });
  };
  rerender("chat-1");

  const fixture = { cancel, container, finish, queryClient, rerender, root };
  fixtures.push(fixture);
  return fixture;
}

function findButton(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const match = findButton(container, name);
  expect(match, `button named ${name}`).toBeDefined();
  return match!;
}

function click(container: HTMLElement, name: string): void {
  act(() => button(container, name).click());
}

async function clickAsync(container: HTMLElement, name: string): Promise<void> {
  await act(async () => button(container, name).click());
}

function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setValue?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressKey(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

function advance(container: HTMLElement, count: number): void {
  for (let index = 0; index < count; index += 1) click(container, "Next");
}

function dialog(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[role="dialog"]');
  expect(element, "setup dialog").not.toBeNull();
  return element!;
}

function dialogName(container: HTMLElement): string {
  const labelId = dialog(container).getAttribute("aria-labelledby");
  return labelId ? (document.getElementById(labelId)?.textContent ?? "") : "";
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function unmountFixture(fixture: SetupFixture): void {
  const index = fixtures.indexOf(fixture);
  if (index >= 0) fixtures.splice(index, 1);
  act(() => fixture.root.unmount());
  fixture.container.remove();
  fixture.queryClient.clear();
}

function chatUpdates(): Array<Record<string, unknown>> {
  return [...mocks.updateChat.mock.calls, ...mocks.updateChatAsync.mock.calls].map(
    ([update]) => update as Record<string, unknown>,
  );
}

const MIRA = { id: "mira", data: { name: "Mira", tags: [] }, comment: "Tavern keeper" };
const JUN = { id: "jun", data: { name: "Jun", tags: [] }, comment: null };

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    act(() => fixture.root.unmount());
    fixture.container.remove();
    fixture.queryClient.clear();
  }
  vi.clearAllMocks();
  vi.useRealTimers();
  act(() => useUIStore.getState().closeModal());
  for (const list of [
    mocks.characters,
    mocks.chatPresets,
    mocks.connections,
    mocks.lorebooks,
    mocks.messages,
    mocks.personas,
    mocks.promptPresets,
  ]) {
    list.length = 0;
  }
  for (const key of Object.keys(mocks.cards)) delete mocks.cards[key];
  mocks.presetFull = { data: undefined, isLoading: false };
});

describe("New conversation card", () => {
  it("gives a new conversation a connection that can reply, not a half-finished one listed first", () => {
    mocks.connections.push(
      { id: "unfinished", name: "OpenRouter", provider: "openrouter", model: "", hasApiKey: false },
      { id: "working", name: "OpenRouter", provider: "openrouter", model: "openrouter/free", hasApiKey: true },
    );
    renderSetup("conversation");

    expect(mocks.updateChat).toHaveBeenCalledWith({ id: "chat-1", connectionId: "working" });
    expect(mocks.updateChat).not.toHaveBeenCalledWith({ id: "chat-1", connectionId: "unfinished" });
  });

  it("opens as a labeled dialog with the search box focused and Start chatting waiting for a character", async () => {
    mocks.connections.push({ id: "working", name: "Main", provider: "openai", model: "gpt", hasApiKey: true });
    mocks.characters.push(MIRA);
    const { container } = renderSetup("conversation", { chat: { connectionId: "working" } });

    expect(dialog(container).getAttribute("aria-modal")).toBe("true");
    expect(dialogName(container)).toBe("New conversation");
    expect(document.activeElement?.getAttribute("placeholder")).toBe("Search characters…");
    expect(button(container, "Start chatting").disabled).toBe(true);

    await clickAsync(container, "Add Mira");

    expect(button(container, "Start chatting").disabled).toBe(false);
    expect(button(container, "Remove Mira")).toBeDefined();
  });

  it("names the chat after its characters, shows the group size, and stops renaming once the name is edited", async () => {
    mocks.characters.push(MIRA, JUN);
    const { container } = renderSetup("conversation");

    await clickAsync(container, "Add Mira");
    await clickAsync(container, "Add Jun");

    expect(mocks.updateChatAsync).toHaveBeenLastCalledWith({
      id: "chat-1",
      characterIds: ["mira", "jun"],
      name: "Mira, Jun",
    });
    expect(container.textContent).toContain("Group chat · 2 members");

    await act(async () => button(container, "Remove Jun").click());
    expect(mocks.updateChat).toHaveBeenLastCalledWith({ id: "chat-1", characterIds: ["mira"], name: "Mira" });

    const nameBox = container.querySelector<HTMLInputElement>("input:not([type])")!;
    act(() => nameBox.focus());
    typeInto(nameBox, "Tea time");
    act(() => nameBox.blur());
    expect(mocks.updateChat).toHaveBeenLastCalledWith({ id: "chat-1", name: "Tea time" });

    await clickAsync(container, "Add Jun");
    expect(mocks.updateChatAsync).toHaveBeenLastCalledWith({ id: "chat-1", characterIds: ["mira", "jun"] });
  });

  it("saves the switches and parameters, writes schedules, and says it's ready before finishing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mocks.connections.push({ id: "working", name: "Main", provider: "openai", model: "gpt", hasApiKey: true });
    mocks.characters.push(MIRA);
    const schedules = deferred<{ results: Record<string, unknown> }>();
    mocks.generateSchedules.mockReturnValueOnce(schedules.promise);
    const { container, finish } = renderSetup("conversation", { chat: { connectionId: "working" } });
    await clickAsync(container, "Add Mira");

    const switches = () => [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    const switchNamed = (label: string) =>
      switches().find(
        (element) => document.getElementById(element.getAttribute("aria-labelledby")!)?.textContent === label,
      )!;
    expect(switchNamed("Autonomous messages").getAttribute("aria-checked")).toBe("false");
    act(() => switchNamed("Autonomous messages").click());
    expect(switchNamed("Autonomous messages").getAttribute("aria-checked")).toBe("true");
    act(() => switchNamed("Generate schedule").click());

    await clickAsync(container, "Start chatting");

    expect(mocks.updateMetadataAsync).toHaveBeenCalledWith({
      id: "chat-1",
      autonomousMessages: true,
      conversationSchedulesEnabled: true,
      chatParameters: null,
    });
    expect(mocks.generateSchedules).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ chatId: "chat-1", characterIds: ["mira"] }),
    );
    expect(container.textContent).toContain("Generating schedule(s)… hang tight!");

    await act(async () => schedules.resolve({ results: {} }));

    expect(mocks.refreshStatus).toHaveBeenCalledWith(expect.anything(), { chatId: "chat-1" });
    expect(container.textContent).toContain("Ready! Say hi to start the conversation.");
    expect(finish).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(2_000));
    expect(finish).toHaveBeenCalledOnce();
  });

  it("still finishes when status blurbs fail, and says so", async () => {
    mocks.characters.push(MIRA);
    mocks.refreshStatus.mockRejectedValueOnce(new Error("model down"));
    const { container, finish } = renderSetup("conversation", { chat: { connectionId: "random" } });
    await clickAsync(container, "Add Mira");

    await clickAsync(container, "Start chatting");

    expect(mocks.generateSchedules).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Chat started, but character status blurbs couldn't be created.",
      expect.objectContaining({ description: expect.any(String) }),
    );
    expect(finish).toHaveBeenCalledOnce();
  });

  it("returns to the normal footer when saving fails", async () => {
    mocks.characters.push(MIRA);
    mocks.updateMetadataAsync.mockRejectedValueOnce(new Error("disk full"));
    const { container, finish } = renderSetup("conversation", { chat: { connectionId: "random" } });
    await clickAsync(container, "Add Mira");

    await clickAsync(container, "Start chatting");

    expect(mocks.toastError).toHaveBeenCalledWith("Conversation setup didn't finish. Try again.");
    expect(finish).not.toHaveBeenCalled();
    expect(button(container, "Start chatting").disabled).toBe(false);
  });

  it("carries the saved custom conversation prompt into the chat", () => {
    act(() => useUIStore.getState().setCustomConversationPrompt("Text like a friend."));
    try {
      renderSetup("conversation");
      expect(mocks.updateMetadata).toHaveBeenCalledWith({ id: "chat-1", customSystemPrompt: "Text like a friend." });
    } finally {
      act(() => useUIStore.getState().setCustomConversationPrompt(null));
    }
  });

  it("leaves through cancel when setting up a connection (decision 7)", () => {
    const { cancel, container, finish } = renderSetup("conversation");

    click(container, "Set up a connection");

    expect(useUIStore.getState().rightPanel).toBe("connections");
    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("names the default connection on the no-connection option (decision 6)", () => {
    mocks.connections.push(
      { id: "first", name: "First", provider: "openai", model: "gpt", hasApiKey: true },
      { id: "home", name: "Home", provider: "openai", model: "gpt", hasApiKey: true, isDefault: true },
    );
    const { container } = renderSetup("conversation", { chat: { connectionId: "first" } });

    const options = [...container.querySelectorAll("option")].map((option) => option.textContent);
    expect(options).toContain("Default (Home)");
    expect(options).toContain("🎲 Random");
    expect(options).not.toContain("None");
  });

  it("closes with Escape and Skip finishes", () => {
    const first = renderSetup("conversation");
    pressKey("Escape");
    expect(first.cancel).toHaveBeenCalledOnce();

    const second = renderSetup("conversation");
    click(second.container, "Skip");
    expect(second.finish).toHaveBeenCalledOnce();
    expect(second.cancel).not.toHaveBeenCalled();
  });
});

describe("Roleplay wizard exits", () => {
  it("uses cancel when the backdrop is tapped", () => {
    const { cancel, container, finish } = renderSetup("roleplay");

    act(() => container.querySelector<HTMLElement>("[data-setup-backdrop]")!.click());

    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("uses cancel before opening Connections", () => {
    const { cancel, container, finish } = renderSetup("roleplay");

    click(container, "Set up a connection");

    expect(useUIStore.getState().rightPanel).toBe("connections");
    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("uses cancel before opening Characters from the wizard and from Quick setup", () => {
    const wizard = renderSetup("roleplay");
    advance(wizard.container, 3);
    click(wizard.container, "Open Characters");
    expect(wizard.cancel).toHaveBeenCalledOnce();

    const quick = renderSetup("roleplay");
    click(quick.container, "Use settings presets");
    click(quick.container, "Open Characters");
    expect(quick.cancel).toHaveBeenCalledOnce();
    expect(wizard.finish).not.toHaveBeenCalled();
    expect(quick.finish).not.toHaveBeenCalled();
  });

  it("uses cancel when the workflow chooser navigates away", () => {
    const { cancel, container, finish } = renderSetup("roleplay");
    advance(container, 5);

    click(container, "Open workflow destination");

    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("closes with Escape, and Skip finishes without saving parameters (decision 4)", () => {
    const first = renderSetup("roleplay");
    pressKey("Escape");
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(first.finish).not.toHaveBeenCalled();

    const second = renderSetup("roleplay");
    click(second.container, "Skip");
    expect(second.finish).toHaveBeenCalledOnce();
    expect(second.cancel).not.toHaveBeenCalled();
    expect(mocks.updateMetadataAsync).not.toHaveBeenCalled();
  });

  it("saves the parameters and finishes on Done", async () => {
    const { cancel, container, finish } = renderSetup("roleplay");
    advance(container, 5);

    await clickAsync(container, "Done");

    expect(mocks.updateMetadataAsync).toHaveBeenCalledWith({ id: "chat-1", chatParameters: null });
    expect(finish).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("Roleplay wizard steps", () => {
  it("walks the six steps with Back, shows the dots, and labels the dialog by the step", () => {
    const { container } = renderSetup("roleplay");

    expect(dialogName(container)).toBe("Choose a connection");
    expect(findButton(container, "Back")).toBeUndefined();
    expect(container.textContent).toContain("Step 1 of 6");
    advance(container, 2);
    expect(dialogName(container)).toBe("Select your persona");
    click(container, "Back");
    expect(dialogName(container)).toBe("Pick a preset");
    advance(container, 4);
    expect(dialogName(container)).toBe("Choose a workflow profile");
    expect(container.textContent).toContain("Step 6 of 6");
  });

  it("picks the default prompt preset on open", () => {
    mocks.promptPresets.push({ id: "custom", name: "Custom" }, { id: "universal", name: "Universal", isDefault: true });
    renderSetup("roleplay");

    expect(mocks.updateChat).toHaveBeenCalledWith({ id: "chat-1", promptPresetId: "universal" });
  });

  it("waits for the preset's details and opens its choices before moving on", () => {
    mocks.promptPresets.push({ id: "universal", name: "Universal", isDefault: true });
    mocks.presetFull = { data: undefined, isLoading: true };
    const fixture = renderSetup("roleplay");
    advance(fixture.container, 1);

    expect(button(fixture.container, "Next").disabled).toBe(true);

    mocks.presetFull = { data: { choiceBlocks: [{ id: "block" }] }, isLoading: false };
    fixture.rerender("chat-1");
    click(fixture.container, "Next");
    expect(dialogName(fixture.container)).toBe("Pick a preset");
    expect(findButton(fixture.container, "Close story options")).toBeDefined();

    // The choices own Escape while they show (decision 5).
    pressKey("Escape");
    expect(fixture.cancel).not.toHaveBeenCalled();

    click(fixture.container, "Close story options");
    expect(dialogName(fixture.container)).toBe("Select your persona");
  });

  it("creates a character inside the empty Characters step and adds it to this roleplay", async () => {
    const { cancel, container, finish } = renderSetup("roleplay");
    advance(container, 3);

    typeInto(container.querySelector<HTMLInputElement>('input[placeholder="e.g. Mira"]')!, "Mira");
    typeInto(container.querySelector<HTMLTextAreaElement>("textarea")!, "A cheerful tavern keeper.");
    await clickAsync(container, "Create and add");

    const [input] = mocks.createCharacter.mock.calls[0] as unknown as [{ name: string; data: { description: string } }];
    expect(input.name).toBe("Mira");
    expect(input.data.description).toBe("A cheerful tavern keeper.");
    expect(chatUpdates()).toContainEqual({ id: "chat-1", characterIds: ["character-new"], name: "Mira" });
    expect(button(container, "Remove Mira")).toBeDefined();
    expect(cancel).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("starts an empty library with a ready-made character, greeting included", async () => {
    mocks.cards["character-new"] = { id: "character-new", data: { name: "Wisp", first_mes: "Do we have a deal?" } };
    const { container } = renderSetup("roleplay");
    advance(container, 3);

    const wisp = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.trim().startsWith("Wisp"),
    );
    await act(async () => wisp!.click());

    const [input] = mocks.createCharacter.mock.calls[0] as unknown as [{ name: string; data: { first_mes: string } }];
    expect(input.name).toBe("Wisp");
    expect(chatUpdates()).toContainEqual({ id: "chat-1", characterIds: ["character-new"], name: "Wisp" });
    expect(mocks.createMessage).toHaveBeenCalledWith({
      role: "assistant",
      content: "Do we have a deal?",
      characterId: "character-new",
    });
  });

  it("adds one greeting with its alternates as swipes and takes it back when the character is removed (decision 1)", async () => {
    mocks.characters.push(MIRA);
    mocks.cards.mira = {
      id: "mira",
      data: { name: "Mira", first_mes: "Welcome in!", alternate_greetings: ["Back again?", "  ", "Sit anywhere."] },
    };
    const { container } = renderSetup("roleplay");
    advance(container, 3);

    await clickAsync(container, "Add Mira");

    expect(mocks.createMessage).toHaveBeenCalledOnce();
    expect(mocks.createMessage).toHaveBeenCalledWith({
      role: "assistant",
      content: "Welcome in!",
      characterId: "mira",
    });
    expect(mocks.addSwipe.mock.calls).toEqual([
      ["chat-1", "greeting-1", "Back again?", { activate: false }],
      ["chat-1", "greeting-1", "Sit anywhere.", { activate: false }],
    ]);

    await clickAsync(container, "Remove Mira");

    expect(mocks.deleteMessage).toHaveBeenCalledWith("greeting-1");
    expect(chatUpdates()).toContainEqual({ id: "chat-1", characterIds: [], name: "New Roleplay" });
  });

  it("keeps the greeting once the user has written in the chat", async () => {
    mocks.characters.push(MIRA);
    mocks.cards.mira = { id: "mira", data: { name: "Mira", first_mes: "Welcome in!" } };
    mocks.messages.push({ id: "user-1", role: "user", content: "hi" });
    const { container } = renderSetup("roleplay");
    advance(container, 3);

    await clickAsync(container, "Add Mira");
    await clickAsync(container, "Remove Mira");

    expect(mocks.deleteMessage).not.toHaveBeenCalled();
  });

  it("says when a greeting couldn't be added", async () => {
    mocks.characters.push(MIRA);
    mocks.cards.mira = { id: "mira", data: { name: "Mira", first_mes: "Welcome in!" } };
    mocks.createMessage.mockRejectedValueOnce(new Error("nope"));
    const { container } = renderSetup("roleplay");
    advance(container, 3);

    await clickAsync(container, "Add Mira");

    expect(mocks.toastError).toHaveBeenCalledWith("Couldn't add the character's greeting. Try again.");
  });

  it("opens character import on top of setup, and Escape there closes only the import", () => {
    const { cancel, container, finish } = renderSetup("roleplay");
    advance(container, 3);

    click(container, "Import a character card");
    expect(useUIStore.getState().modal?.type).toBe("import-character");
    pressKey("Escape");
    expect(cancel).not.toHaveBeenCalled();
    act(() => useUIStore.getState().closeModal());

    const modalHost = document.createElement("div");
    document.body.appendChild(modalHost);
    const modalRoot = createRoot(modalHost);
    const closeModal = vi.fn();
    act(() => {
      modalRoot.render(
        <Modal open onClose={closeModal} title="Import character">
          <p>import</p>
        </Modal>,
      );
    });

    pressKey("Escape");
    expect(closeModal).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    act(() => modalRoot.unmount());
    modalHost.remove();

    pressKey("Escape");
    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("ignores a key press something else already handled", () => {
    const { cancel } = renderSetup("roleplay");
    const handleFirst = (event: Event) => event.preventDefault();
    document.body.addEventListener("keydown", handleFirst);

    pressKey("Escape");

    document.body.removeEventListener("keydown", handleFirst);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("Roleplay lorebooks step", () => {
  it("says there are no lorebooks yet instead of claiming they were all added", () => {
    const { container } = renderSetup("roleplay");
    advance(container, 4);

    expect(dialogName(container)).toBe("Attach lorebooks");
    expect(container.textContent).toContain("No lorebooks yet.");
    expect(container.textContent).not.toContain("All lorebooks already added.");
    expect(container.querySelector('input[placeholder="Search lorebooks…"]')).toBeNull();
  });

  it("lists lorebooks that can be attached here and saves the pick", () => {
    mocks.lorebooks.push(
      { id: "sky", name: "Sky Isles", enabled: true },
      { id: "off", name: "Switched off", enabled: false },
    );
    const { container } = renderSetup("roleplay");
    advance(container, 4);

    expect(container.textContent).toContain("Sky Isles");
    expect(container.textContent).not.toContain("Switched off");
    click(container, "Attach Sky Isles");
    expect(mocks.updateMetadata).toHaveBeenCalledWith({ id: "chat-1", activeLorebookIds: ["sky"] });
    expect(container.textContent).toContain("All lorebooks already added.");
  });

  it("does not say there are none while an attached lorebook is listed", () => {
    mocks.lorebooks.push({ id: "off", name: "Old Notes", enabled: false });
    const { container } = renderSetup("roleplay", { metadata: { activeLorebookIds: ["off"] } });
    advance(container, 4);

    expect(container.textContent).toContain("Old Notes");
    expect(container.textContent).not.toContain("No lorebooks yet.");
  });

  it("ignores an attached id whose lorebook was deleted (decision 3)", () => {
    const empty = renderSetup("roleplay", { metadata: { activeLorebookIds: ["deleted"] } });
    advance(empty.container, 4);
    expect(empty.container.textContent).toContain("No lorebooks yet.");
    expect(empty.container.textContent).not.toContain("All lorebooks already added.");
    unmountFixture(empty);

    mocks.lorebooks.push({ id: "sky", name: "Sky Isles", enabled: true });
    const withLibrary = renderSetup("roleplay", { metadata: { activeLorebookIds: ["deleted"] } });
    advance(withLibrary.container, 4);
    expect(withLibrary.container.textContent).toContain("Sky Isles");
    expect(withLibrary.container.textContent).not.toContain("All lorebooks already added.");
  });
});

describe("Roleplay workflow step", () => {
  it("names the Done button in its help and switches it to Apply & finish once a profile is picked", () => {
    const { container } = renderSetup("roleplay");
    advance(container, 5);

    expect(container.textContent).toContain("To start chatting now, press Done.");
    expect(button(container, "Done")).toBeDefined();

    click(container, "Pick workflow profile");

    expect(button(container, "Apply & finish")).toBeDefined();
  });

  it("applies a picked profile before finishing", async () => {
    const { container, finish } = renderSetup("roleplay");
    advance(container, 5);
    click(container, "Pick workflow profile");

    await clickAsync(container, "Apply & finish");

    expect(mocks.applyPendingProfile).toHaveBeenCalledOnce();
    expect(mocks.updateMetadataAsync).toHaveBeenCalledWith({ id: "chat-1", chatParameters: null });
    expect(finish).toHaveBeenCalledOnce();
  });

  it("stays open when the picked profile could not be applied", async () => {
    mocks.applyPendingProfile.mockResolvedValueOnce(false);
    const { container, finish } = renderSetup("roleplay");
    advance(container, 5);
    click(container, "Pick workflow profile");

    await clickAsync(container, "Apply & finish");

    expect(mocks.applyPendingProfile).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
    expect(button(container, "Apply & finish").disabled).toBe(false);
  });
});

describe("Quick setup", () => {
  function pendingApply() {
    const apply = deferred<undefined>();
    mocks.applyChatPreset.mockImplementationOnce(() => apply.promise);
    return apply;
  }

  it("opens from a setup intent, starts on this chat's applied preset, and clears the intent flag", () => {
    mocks.chatPresets.push(
      { id: "preset-default", name: "Default settings", isDefault: true },
      { id: "starred", name: "Cozy", isActive: true },
      { id: "applied", name: "Grim" },
    );
    act(() => useChatStore.getState().setShouldOpenWizardInShortcutMode(true));
    const { container } = renderSetup("roleplay", { metadata: { appliedChatPresetId: "applied" } });

    expect(dialogName(container)).toBe("Quick setup");
    expect(useChatStore.getState().shouldOpenWizardInShortcutMode).toBe(false);
    const select = container.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("applied");
    expect([...select.options].map((option) => option.textContent)).toContain("Default");
  });

  it("starts on the starred preset, else the default", () => {
    mocks.chatPresets.push(
      { id: "preset-default", name: "x", isDefault: true },
      { id: "starred", name: "Cozy", active: "true" },
    );
    const { container } = renderSetup("roleplay");
    click(container, "Use settings presets");
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("starred");
  });

  it("finishes only after the preset is saved", async () => {
    mocks.chatPresets.push({ id: "preset-default", name: "Default", isDefault: true });
    const apply = pendingApply();
    const { cancel, container, finish } = renderSetup("roleplay");

    click(container, "Use settings presets");
    await clickAsync(container, "Apply & start");

    expect(mocks.applyChatPreset).toHaveBeenCalledWith({ presetId: "preset-default", chatId: "chat-1" });
    expect(finish).not.toHaveBeenCalled();
    expect(button(container, "Applying…").disabled).toBe(true);

    await act(async () => apply.resolve(undefined));

    expect(finish).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("never finishes after it is closed", async () => {
    mocks.chatPresets.push({ id: "preset-default", name: "Default", isDefault: true });
    const apply = pendingApply();
    const { cancel, container, finish } = renderSetup("roleplay");

    click(container, "Use settings presets");
    await clickAsync(container, "Apply & start");
    click(container, "Close");
    expect(cancel).toHaveBeenCalledOnce();

    await act(async () => apply.resolve(undefined));
    expect(finish).not.toHaveBeenCalled();
  });

  it("never finishes after going Back, and allows no second apply while the first is pending", async () => {
    mocks.chatPresets.push({ id: "preset-default", name: "Default", isDefault: true });
    const apply = pendingApply();
    const { cancel, container, finish } = renderSetup("roleplay");

    click(container, "Use settings presets");
    await clickAsync(container, "Apply & start");
    click(container, "Back");
    expect(dialogName(container)).toBe("Choose a connection");

    click(container, "Use settings presets");
    const stillPending = button(container, "Applying…");
    expect(stillPending.disabled).toBe(true);
    act(() => stillPending.click());
    expect(mocks.applyChatPreset).toHaveBeenCalledOnce();

    await act(async () => apply.resolve(undefined));

    expect(finish).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(button(container, "Apply & start").disabled).toBe(false);
  });

  it("never finishes for a chat setup has moved on from, or once setup is gone", async () => {
    mocks.chatPresets.push({ id: "preset-default", name: "Default", isDefault: true });
    const firstApply = pendingApply();
    const switched = renderSetup("roleplay");
    click(switched.container, "Use settings presets");
    await clickAsync(switched.container, "Apply & start");
    switched.rerender("chat-2");
    await act(async () => firstApply.resolve(undefined));
    expect(switched.finish).not.toHaveBeenCalled();

    const secondApply = pendingApply();
    const unmounted = renderSetup("roleplay");
    click(unmounted.container, "Use settings presets");
    await clickAsync(unmounted.container, "Apply & start");
    unmountFixture(unmounted);
    await act(async () => secondApply.resolve(undefined));
    expect(unmounted.finish).not.toHaveBeenCalled();
    expect(unmounted.cancel).not.toHaveBeenCalled();
  });

  it("stays open and shows the error when the apply is rejected", async () => {
    mocks.chatPresets.push({ id: "preset-default", name: "Default", isDefault: true });
    mocks.applyChatPreset.mockRejectedValueOnce(new Error("Could not save preset"));
    const { cancel, container, finish } = renderSetup("roleplay");

    click(container, "Use settings presets");
    await clickAsync(container, "Apply & start");

    expect(mocks.toastError).toHaveBeenCalledWith("Couldn't apply the chat preset. Try again.");
    expect(finish).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(button(container, "Apply & start").disabled).toBe(false);
  });

  it("goes back to the wizard on Escape instead of closing (decision 5)", () => {
    const { cancel, container } = renderSetup("roleplay");
    click(container, "Use settings presets");

    pressKey("Escape");

    expect(cancel).not.toHaveBeenCalled();
    expect(dialogName(container)).toBe("Choose a connection");
  });

  it("adds a character with its greeting", async () => {
    mocks.characters.push(MIRA);
    mocks.cards.mira = { id: "mira", data: { name: "Mira", first_mes: "Welcome in!" } };
    const { container } = renderSetup("roleplay");
    click(container, "Use settings presets");

    await clickAsync(container, "Add Mira");

    expect(container.textContent).toContain("Characters · 1");
    expect(mocks.createMessage).toHaveBeenCalledWith({
      role: "assistant",
      content: "Welcome in!",
      characterId: "mira",
    });
  });
});

describe("Setup dialog keyboard use (decision 8)", () => {
  it("moves focus in, keeps Tab inside, and gives focus back on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const fixture = renderSetup("roleplay");
    const setup = dialog(fixture.container);

    expect(document.activeElement).toBe(setup);

    const focusable = [...setup.querySelectorAll<HTMLElement>("button:not([disabled]), select, input")];
    act(() => focusable.at(-1)!.focus());
    pressKey("Tab", {}, focusable.at(-1)!);
    expect(document.activeElement).toBe(focusable[0]);

    unmountFixture(fixture);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
