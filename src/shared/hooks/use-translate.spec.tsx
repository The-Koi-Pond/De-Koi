import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslationStore } from "../stores/translation.store";

const mocks = vi.hoisted(() => ({
  translateText: vi.fn(),
  storageGet: vi.fn(),
  storageUpdate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../api/translation-api", () => ({
  translationApi: { translateText: (...args: unknown[]) => mocks.translateText(...args) },
}));
vi.mock("../api/storage-api", () => ({
  storageApi: {
    get: (...args: unknown[]) => mocks.storageGet(...args),
    update: (...args: unknown[]) => mocks.storageUpdate(...args),
  },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { useTranslate } from "./use-translate";

describe("useTranslate cancellation", () => {
  let root: Root | null;
  let container: HTMLDivElement;
  let controls: ReturnType<typeof useTranslate>;

  function Harness() {
    controls = useTranslate();
    return null;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.translateText.mockReset();
    mocks.storageGet.mockReset().mockResolvedValue({ extra: {} });
    mocks.storageUpdate.mockReset().mockResolvedValue({});
    mocks.toastError.mockReset();
    useTranslationStore.getState().clearAll();
    act(() => root?.render(<Harness />));
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  it("cancels one message without allowing its late response to display or persist", async () => {
    let resolve!: (value: { translatedText: string }) => void;
    mocks.translateText.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );

    let pending!: Promise<void>;
    act(() => {
      pending = controls.translate("message-1", "hello", "chat-1");
    });
    expect(useTranslationStore.getState().translating["message-1"]).toBe(true);

    act(() => controls.cancelTranslation("message-1", "chat-1"));
    resolve({ translatedText: "late" });
    await act(async () => pending);

    expect(useTranslationStore.getState().translations["message-1"]).toBeUndefined();
    expect(useTranslationStore.getState().translating["message-1"]).toBe(false);
    expect(mocks.storageUpdate).toHaveBeenCalledWith("messages", "message-1", { extra: {} });
    expect(mocks.storageUpdate).not.toHaveBeenCalledWith(
      "messages",
      "message-1",
      expect.objectContaining({ extra: expect.objectContaining({ translation: "late" }) }),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight request when its message surface unmounts", async () => {
    let resolve!: (value: { translatedText: string }) => void;
    mocks.translateText.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );

    let pending!: Promise<void>;
    act(() => {
      pending = controls.translate("message-unmounted", "hello", "chat-1");
    });
    act(() => root?.unmount());
    root = null;
    resolve({ translatedText: "late after unmount" });
    await pending;

    expect(useTranslationStore.getState().translations["message-unmounted"]).toBeUndefined();
    expect(mocks.storageUpdate).not.toHaveBeenCalled();
  });
});
