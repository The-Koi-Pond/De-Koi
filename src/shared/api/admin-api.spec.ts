import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi, ExpungeError, getExpungeFailureReceipt } from "./admin-api";
import { ApiError } from "./api-errors";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock("./tauri-client", () => ({
  invokeTauri: mocks.invokeTauri,
}));

describe("adminApi.expunge", () => {
  beforeEach(() => {
    mocks.invokeTauri.mockReset();
  });

  it("normalizes a legacy success as every requested scope completed", async () => {
    mocks.invokeTauri.mockResolvedValue({ success: true });

    await expect(adminApi.expunge(["chats", "media"])).resolves.toEqual({
      success: true,
      requestedScopes: ["chats", "media"],
      completedScopes: ["chats", "media"],
      remainingScopes: [],
      clearedCollections: [],
    });
  });

  it("preserves a modern success receipt", async () => {
    const receipt = {
      success: true,
      requestedScopes: ["chats", "media"],
      completedScopes: ["chats", "media"],
      remainingScopes: [],
      clearedCollections: ["chats", "gallery"],
    } as const;
    mocks.invokeTauri.mockResolvedValue(receipt);

    await expect(adminApi.expunge(["chats", "media"])).resolves.toEqual(receipt);
  });

  it("preserves a structured partial receipt from a nested AppError payload", async () => {
    const receipt = {
      success: false,
      requestedScopes: ["chats", "connections", "media"],
      completedScopes: ["chats"],
      remainingScopes: ["connections", "media"],
      failedScope: "connections",
      clearedCollections: ["chats", "connection-folders"],
      cause: { code: "io_error", message: "connection storage failed" },
    } as const;
    mocks.invokeTauri.mockRejectedValue(
      new ApiError("Could not finish erasing data", 500, {
        code: "expunge_incomplete",
        message: "Could not finish erasing data",
        details: receipt,
      }),
    );

    const error = await adminApi.expunge(receipt.requestedScopes).catch((cause) => cause);

    expect(error).toBeInstanceOf(ExpungeError);
    expect(getExpungeFailureReceipt(error)).toEqual(receipt);
  });

  it("normalizes a legacy rejection conservatively while keeping the promise rejected", async () => {
    mocks.invokeTauri.mockRejectedValue(
      new ApiError("Remote runtime is unavailable", 503, { code: "remote_runtime_unreachable" }),
    );

    const promise = adminApi.expunge(["chats", "media"]);

    await expect(promise).rejects.toMatchObject({
      name: "ExpungeError",
      message: "Remote runtime is unavailable",
      receipt: {
        success: false,
        requestedScopes: ["chats", "media"],
        completedScopes: [],
        remainingScopes: ["chats", "media"],
        failedScope: null,
        clearedCollections: [],
        cause: {
          code: "remote_runtime_unreachable",
          message: "Remote runtime is unavailable",
        },
      },
    });
  });
});
