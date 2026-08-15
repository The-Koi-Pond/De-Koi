import { describe, expect, it } from "vitest";

import type { GenerationPromptSnapshotMessage } from "../contracts/types/chat";
import { compactPromptSnapshotPreview } from "./prompt-snapshot-preview";

describe("compactPromptSnapshotPreview", () => {
  it("keeps distinct messages inline when JSON serialization returns undefined", () => {
    const canonical = { role: "user", content: "canonical", toJSON: () => undefined } as unknown as GenerationPromptSnapshotMessage;
    const preview = { role: "user", content: "preview", toJSON: () => undefined } as unknown as GenerationPromptSnapshotMessage;

    expect(compactPromptSnapshotPreview([canonical], [preview])).toEqual([{ message: preview }]);
  });
});
