import { describe, expect, it, vi } from "vitest";
import { commitAgentImportBatch, type StagedAgentImportPayload } from "./agent-import-batch";

function staged(name: string): StagedAgentImportPayload {
  return {
    fileName: `${name}.json`,
    payload: {
      type: `custom-${name}`,
      name,
      description: "",
      credit: "",
      imagePath: null,
      phase: "post_processing",
      enabled: true,
      connectionId: null,
      promptTemplate: "",
      settings: {},
    },
  };
}

describe("agent import batch commit", () => {
  it("reports atomic success when every staged agent imports", async () => {
    const createAgent = vi.fn().mockResolvedValueOnce({ id: "agent-1" }).mockResolvedValueOnce({ id: "agent-2" });
    const deleteAgent = vi.fn().mockResolvedValue(undefined);

    const result = await commitAgentImportBatch([staged("first"), staged("second")], createAgent, deleteAgent);

    expect(result).toEqual({
      atomic: true,
      imported: 2,
      failures: [],
      created: [
        { fileName: "first.json", name: "first", id: "agent-1" },
        { fileName: "second.json", name: "second", id: "agent-2" },
      ],
      kept: [],
      rolledBack: [],
      outcomes: [
        { status: "imported", fileName: "first.json", name: "first", id: "agent-1" },
        { status: "imported", fileName: "second.json", name: "second", id: "agent-2" },
      ],
    });
    expect(deleteAgent).not.toHaveBeenCalled();
  });

  it("rolls back earlier creates when a later create fails", async () => {
    const createAgent = vi
      .fn()
      .mockResolvedValueOnce({ id: "agent-1" })
      .mockRejectedValueOnce(new Error("duplicate type"));
    const deleteAgent = vi.fn().mockResolvedValue(undefined);

    const result = await commitAgentImportBatch([staged("first"), staged("second")], createAgent, deleteAgent);

    expect(result).toEqual({
      atomic: false,
      imported: 0,
      failures: [
        "second.json / second: duplicate type",
      ],
      created: [],
      kept: [],
      rolledBack: [{ fileName: "first.json", name: "first", id: "agent-1" }],
      outcomes: [
        { status: "rolled_back", fileName: "first.json", name: "first", id: "agent-1" },
        { status: "failed", fileName: "second.json", name: "second", message: "duplicate type" },
      ],
    });
    expect(deleteAgent).toHaveBeenCalledWith("agent-1");
  });

  it("reports rollback failures with the import failure", async () => {
    const createAgent = vi
      .fn()
      .mockResolvedValueOnce({ id: "agent-1" })
      .mockRejectedValueOnce(new Error("duplicate type"));
    const deleteAgent = vi.fn().mockRejectedValue(new Error("delete denied"));

    const result = await commitAgentImportBatch([staged("first"), staged("second")], createAgent, deleteAgent);

    expect(result).toEqual({
      atomic: false,
      imported: 0,
      failures: [
        "first.json / first: rollback failed for agent-1: delete denied",
        "second.json / second: duplicate type",
      ],
      created: [],
      kept: [{ fileName: "first.json", name: "first", id: "agent-1" }],
      rolledBack: [],
      outcomes: [
        {
          status: "rollback_failed",
          fileName: "first.json",
          name: "first",
          id: "agent-1",
          message: "delete denied",
        },
        { status: "failed", fileName: "second.json", name: "second", message: "duplicate type" },
      ],
    });
  });

  it("reports rows skipped after the first create failure", async () => {
    const createAgent = vi.fn().mockRejectedValueOnce(new Error("duplicate type"));
    const deleteAgent = vi.fn().mockResolvedValue(undefined);

    const result = await commitAgentImportBatch(
      [staged("first"), staged("second"), staged("third")],
      createAgent,
      deleteAgent,
    );

    expect(result).toEqual({
      atomic: false,
      imported: 0,
      failures: [
        "first.json / first: duplicate type",
        "second.json / second: not attempted because an earlier import failed",
        "third.json / third: not attempted because an earlier import failed",
      ],
      created: [],
      kept: [],
      rolledBack: [],
      outcomes: [
        { status: "failed", fileName: "first.json", name: "first", message: "duplicate type" },
        {
          status: "not_attempted",
          fileName: "second.json",
          name: "second",
          message: "not attempted because an earlier import failed",
        },
        {
          status: "not_attempted",
          fileName: "third.json",
          name: "third",
          message: "not attempted because an earlier import failed",
        },
      ],
    });
    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(deleteAgent).not.toHaveBeenCalled();
  });
});
