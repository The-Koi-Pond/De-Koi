import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TTSConfig } from "../../../../../engine/contracts/types/tts";
import { TTSConfigCard } from "./TTSConfigCard";

const mocks = vi.hoisted(() => ({ config: null as unknown as TTSConfig, mutateAsync: vi.fn() }));

vi.mock("../../../../../shared/hooks/use-tts", () => ({
  useTTSConfig: () => ({ data: mocks.config, isLoading: false }),
  useUpdateTTSConfig: () => ({ mutateAsync: mocks.mutateAsync }),
  useTTSVoices: () => ({
    data: {
      voices: ["freddy-voice", "pierrot-voice"],
      voiceOptions: [
        { id: "freddy-voice", name: "Freddy" },
        { id: "pierrot-voice", name: "Pierrot" },
      ],
    },
    isFetching: false,
    refetch: vi.fn(),
    isError: false,
  }),
}));

vi.mock("../../../../catalog/characters/index", () => ({
  useCharacterSummaries: () => ({ data: [] }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function baseConfig(overrides: Partial<TTSConfig>): TTSConfig {
  return {
    enabled: true,
    source: "elevenlabs",
    baseUrl: "https://api.elevenlabs.io",
    voicesPath: "",
    apiKey: "",
    model: "eleven_v3",
    voice: "freddy-voice",
    audioFormat: "mp3",
    narratorVoiceEnabled: false,
    narratorVoice: "",
    voiceMode: "per-character",
    voiceAssignments: [{ characterId: "pierrot", characterName: "Pierrot", voice: "pierrot-voice" }],
    npcDefaultVoicesEnabled: false,
    npcDefaultMaleVoices: [],
    npcDefaultFemaleVoices: [],
    requestTimeoutMs: 60000,
    speed: 1,
    elevenLabsStability: 0.5,
    elevenLabsLanguageCode: "",
    autoplayRP: false,
    autoplayConvo: false,
    autoplayGame: false,
    autoplayStreaming: false,
    dialogueOnly: false,
    dialogueScope: "all",
    dialogueCharacterName: "",
    speechInputProvider: false,
    sttModel: "",
    ...overrides,
  } as TTSConfig;
}

describe("TTSConfigCard narrator voice", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderExpanded() {
    act(() => root.render(<TTSConfigCard />));
    const expand = container.querySelector<HTMLButtonElement>('button[title="Expand"]');
    if (!expand) throw new Error("Missing expand button");
    act(() => expand.click());
  }

  function toggle(label: string): HTMLInputElement {
    const row = Array.from(container.querySelectorAll("label")).find((item) => item.textContent === label);
    const input = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) throw new Error(`Missing toggle: ${label}`);
    return input;
  }

  it("lets per-character users pick the voice Fanfic chapters are read in", () => {
    mocks.config = baseConfig({ voiceMode: "per-character" });
    renderExpanded();

    act(() => toggle("Use a narrator voice for Fanfic").click());
    const picker = container.querySelector<HTMLSelectElement>('select[aria-label="Narrator voice selection"]');
    expect(picker).not.toBeNull();
    expect(Array.from(picker!.options).map((option) => option.value)).toContain("pierrot-voice");
  });

  it("keeps the dialogue-split wording in single-voice mode", () => {
    mocks.config = baseConfig({ voiceMode: "single", voiceAssignments: [] });
    renderExpanded();

    expect(toggle("Split quoted dialogue from narration")).toBeTruthy();
  });
});
