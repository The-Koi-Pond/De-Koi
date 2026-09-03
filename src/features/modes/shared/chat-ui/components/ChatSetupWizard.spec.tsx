import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatSetupWizard } from "./ChatSetupWizard";

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(async () => ({ id: "message-1" })),
  updateChat: vi.fn(),
  updateMetadata: vi.fn(),
  updateMetadataAsync: vi.fn(async () => undefined),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        React.forwardRef<HTMLElement, Record<string, unknown>>(function MotionElement(
          { animate: _animate, exit: _exit, initial: _initial, transition: _transition, ...props },
          ref,
        ) {
          return React.createElement(tag, { ...props, ref });
        }),
    },
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion,
  };
});

vi.mock("../../../../catalog/chats/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/chats/index")>();
  return {
    ...actual,
    useCreateMessage: () => ({ mutateAsync: mocks.createMessage }),
    useUpdateChat: () => ({ isPending: false, mutate: mocks.updateChat }),
    useUpdateChatMetadata: () => ({ mutate: mocks.updateMetadata, mutateAsync: mocks.updateMetadataAsync }),
  };
});

vi.mock("../../../../catalog/characters/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/characters/index")>();
  return {
    ...actual,
    useCharacterSummaries: () => ({ data: [], isError: false, isFetching: false }),
    useCharacterSummariesByIds: () => ({ data: [] }),
  };
});

vi.mock("../../../../catalog/chat-presets/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../catalog/chat-presets/index")>();
  return {
    ...actual,
    RoleplayWorkflowProfileChooser: ({ onNavigateAway }: { onNavigateAway?: () => void }) => (
      <button onClick={onNavigateAway}>Open workflow destination</button>
    ),
    useApplyChatPreset: () => ({ mutateAsync: vi.fn(async () => undefined) }),
    useChatPresets: () => ({ data: [] }),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface WizardFixture {
  cancel: ReturnType<typeof vi.fn>;
  container: HTMLDivElement;
  finish: ReturnType<typeof vi.fn>;
  queryClient: QueryClient;
  root: Root;
}

const fixtures: WizardFixture[] = [];

function renderRoleplayWizard(): WizardFixture {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const finish = vi.fn();
  const cancel = vi.fn();

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChatSetupWizard
          chat={{ id: "chat-1", mode: "roleplay", metadata: "{}" } as never}
          onFinish={finish}
          onCancel={cancel}
        />
      </QueryClientProvider>,
    );
  });

  const fixture = { cancel, container, finish, queryClient, root };
  fixtures.push(fixture);
  return fixture;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  expect(match, `button labelled ${label}`).toBeDefined();
  return match!;
}

function click(container: HTMLElement, label: string): void {
  act(() => button(container, label).click());
}

function advance(container: HTMLElement, count: number): void {
  for (let index = 0; index < count; index += 1) click(container, "Next");
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    act(() => fixture.root.unmount());
    fixture.container.remove();
    fixture.queryClient.clear();
  }
  vi.clearAllMocks();
});

describe("ChatSetupWizard Roleplay exits", () => {
  it("uses cancel rather than finish when the backdrop dismisses setup", () => {
    const { cancel, container, finish } = renderRoleplayWizard();

    act(() => {
      container.querySelector<HTMLDivElement>(".absolute.inset-0.z-40")?.click();
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("uses cancel rather than finish before opening Connections", () => {
    const { cancel, container, finish } = renderRoleplayWizard();

    click(container, "Set Up a Connection");

    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("uses cancel rather than finish before opening Characters from the ordinary wizard", () => {
    const { cancel, container, finish } = renderRoleplayWizard();
    advance(container, 3);

    click(container, "Open Characters");

    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("uses cancel rather than finish before opening Characters from quick setup", () => {
    const { cancel, container, finish } = renderRoleplayWizard();

    click(container, "Use Settings PresetsPresets");
    click(container, "Open Characters");

    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("uses cancel rather than finish when the workflow ledger navigates away", () => {
    const { cancel, container, finish } = renderRoleplayWizard();
    advance(container, 5);

    click(container, "Open workflow destination");

    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("lets the keyboard dismiss the ordinary wizard without finishing it", () => {
    const { cancel, finish } = renderRoleplayWizard();

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it("keeps Skip as an explicit finish", () => {
    const { cancel, container, finish } = renderRoleplayWizard();

    click(container, "Skip");

    expect(finish).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("keeps successful completion as an explicit finish", async () => {
    const { cancel, container, finish } = renderRoleplayWizard();
    advance(container, 5);

    await act(async () => button(container, "Done").click());

    expect(mocks.updateMetadataAsync).toHaveBeenCalledWith({
      id: "chat-1",
      chatParameters: null,
    });
    expect(finish).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });
});
