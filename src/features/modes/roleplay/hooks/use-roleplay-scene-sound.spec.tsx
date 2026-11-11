import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { MessageWithSwipes } from "../../shared/chat-ui/index";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useRoleplaySceneSound } from "./use-roleplay-scene-sound";

const player = vi.hoisted(() => ({
  setVolumes: vi.fn(),
  setAmbient: vi.fn(),
  playEffect: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../../../shared/lib/scene-sound-player", () => ({ sceneSoundPlayer: player }));
vi.mock("../../../../shared/hooks/use-tts", () => ({
  useTTSConfig: () => ({ data: { enabled: false, source: "elevenlabs", baseUrl: "https://api.elevenlabs.io" } }),
}));

function reply(id: string, content: string, activeSwipeIndex = 0, chatId = "c1"): MessageWithSwipes {
  return { id, chatId, role: "assistant", content, activeSwipeIndex } as MessageWithSwipes;
}

type Props = { messages: MessageWithSwipes[] | undefined; isStreaming: boolean; chatId: string };

function Probe(props: Props) {
  useRoleplaySceneSound({ ...props, sceneText: "" });
  return null;
}

const roots: Root[] = [];

function render(initial: Props) {
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const rerender = (props: Props) => act(() => root.render(<Probe {...props} />));
  rerender(initial);
  return { rerender };
}

describe("useRoleplaySceneSound", () => {
  afterEach(() => {
    act(() => roots.splice(0).forEach((root) => root.unmount()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ roleplaySceneSound: true });
  });

  it("plays one effect per new reply, and nothing for the replies already there when the chat opens", () => {
    const opening = [reply("a", "Thunder cracks overhead.")];
    const hook = render({ chatId: "c1", messages: undefined, isStreaming: false });
    hook.rerender({ chatId: "c1", messages: opening, isStreaming: false });
    expect(player.playEffect).not.toHaveBeenCalled();

    // A reply streams in: nothing until it finishes.
    const streaming = [...opening, reply("b", "The door slams")];
    hook.rerender({ chatId: "c1", messages: streaming, isStreaming: true });
    expect(player.playEffect).not.toHaveBeenCalled();
    const done = [...opening, reply("b", "Behind her, the door slams shut. Thunder booms.")];
    hook.rerender({ chatId: "c1", messages: done, isStreaming: false });
    expect(player.playEffect).toHaveBeenCalledTimes(1);
    expect(player.playEffect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "door-slam" }));

    // Re-rendering the same reply plays nothing more.
    hook.rerender({ chatId: "c1", messages: [...done], isStreaming: false });
    expect(player.playEffect).toHaveBeenCalledTimes(1);

    // A new swipe of that reply is a new reply; the same door never plays twice in a row.
    hook.rerender({
      chatId: "c1",
      messages: [...opening, reply("b", "The door slams. Thunder booms.", 1)],
      isStreaming: false,
    });
    expect(player.playEffect).toHaveBeenCalledTimes(2);
    expect(player.playEffect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "thunder" }));
  });

  it("plays nothing when switching to a chat while the previous chat's messages are still shown", () => {
    const hook = render({ chatId: "c1", messages: [reply("a", "Quiet.")], isStreaming: false });
    hook.rerender({ chatId: "c2", messages: [reply("a", "Quiet.")], isStreaming: false });
    hook.rerender({ chatId: "c2", messages: [reply("z", "The door slams shut.", 0, "c2")], isStreaming: false });
    expect(player.playEffect).not.toHaveBeenCalled();
  });

  it("stays silent and asks for no sound when scene sound is off", () => {
    useUIStore.setState({ roleplaySceneSound: false });
    const hook = render({
      chatId: "c1",
      messages: [reply("a", "Rain, rain on the circus tents.")],
      isStreaming: false,
    });
    hook.rerender({ chatId: "c1", messages: [reply("a", "x"), reply("b", "The door slams.")], isStreaming: false });
    expect(player.playEffect).not.toHaveBeenCalled();
    expect(player.setAmbient).not.toHaveBeenCalled();
  });

  it("asks for the ambient bed once while the scene stays the same", () => {
    const messages = [reply("a", "Rain drums on the roof; rain runs down the glass.")];
    const hook = render({ chatId: "c1", messages, isStreaming: false });
    expect(player.setAmbient).toHaveBeenCalledTimes(1);
    expect(player.setAmbient).toHaveBeenLastCalledWith(expect.objectContaining({ id: "rain", durationSeconds: 20 }));
    hook.rerender({ chatId: "c1", messages: [...messages, reply("b", "She smiles.")], isStreaming: false });
    // Same bed: the player is told the same id, which it ignores.
    expect(player.setAmbient).toHaveBeenLastCalledWith(expect.objectContaining({ id: "rain" }));
  });
});
