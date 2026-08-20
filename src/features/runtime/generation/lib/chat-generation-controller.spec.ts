import { beforeEach, describe, expect, it } from "vitest";

import { useChatStore } from "../../../../shared/stores/chat.store";
import { acquireChatGenerationController, releaseChatGenerationController } from "./chat-generation-controller";

describe("chat generation controller", () => {
  beforeEach(() => {
    useChatStore.setState({ abortControllers: new Map() });
  });

  it("gives each chat one shared controller and only lets its owner release it", () => {
    const controller = acquireChatGenerationController("chat-1");

    expect(controller).toBeInstanceOf(AbortController);
    expect(useChatStore.getState().abortControllers.get("chat-1")).toBe(controller);
    expect(acquireChatGenerationController("chat-1")).toBeNull();

    releaseChatGenerationController("chat-1", new AbortController());
    expect(useChatStore.getState().abortControllers.get("chat-1")).toBe(controller);

    releaseChatGenerationController("chat-1", controller!);
    expect(useChatStore.getState().abortControllers.has("chat-1")).toBe(false);
  });
});
