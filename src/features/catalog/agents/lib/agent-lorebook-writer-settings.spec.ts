import { describe, expect, it } from "vitest";
import {
  buildAgentLorebookWriterSaveState,
  LOREBOOK_WRITE_TOOL_NAME,
  normalizeAgentLorebookWriterEditorState,
} from "./agent-lorebook-writer-settings";

describe("agent lorebook writer settings", () => {
  it("normalizes existing writer settings without keeping the hidden writer tool in editor state", () => {
    const state = normalizeAgentLorebookWriterEditorState(
      {
        enabledTools: ["search_lorebook", LOREBOOK_WRITE_TOOL_NAME],
        lorebookWriteEnabled: true,
        writableLorebookId: " book-1 ",
      },
      [],
    );

    expect(state).toEqual({
      enabledTools: ["search_lorebook"],
      lorebookWriteEnabled: true,
      writableLorebookId: "book-1",
    });
  });

  it("does not infer writer mode from a stale hidden tool", () => {
    const state = normalizeAgentLorebookWriterEditorState(
      {
        enabledTools: ["search_lorebook", LOREBOOK_WRITE_TOOL_NAME],
        targetLorebookId: "book-1",
      },
      [],
    );

    expect(state).toEqual({
      enabledTools: ["search_lorebook"],
      lorebookWriteEnabled: false,
      writableLorebookId: "book-1",
    });
  });

  it("saves exactly one writable lorebook target and the writer tool when enabled", () => {
    const state = buildAgentLorebookWriterSaveState({
      enabledTools: ["search_lorebook", LOREBOOK_WRITE_TOOL_NAME, "search_lorebook"],
      isEditingCustomAgent: true,
      lorebookWriteEnabled: true,
      writableLorebookId: " book-1 ",
    });

    expect(state).toEqual({
      enabledTools: ["search_lorebook", LOREBOOK_WRITE_TOOL_NAME],
      lorebookWriterEnabled: true,
      writableLorebookId: "book-1",
      writerSettings: {
        lorebookWriteEnabled: true,
        writableLorebookId: "book-1",
        writableLorebookIds: ["book-1"],
      },
    });
  });

  it("strips writer fields and stale writer tools when disabled", () => {
    const state = buildAgentLorebookWriterSaveState({
      enabledTools: ["search_lorebook", LOREBOOK_WRITE_TOOL_NAME],
      isEditingCustomAgent: true,
      lorebookWriteEnabled: false,
      writableLorebookId: "book-1",
    });
    const savedSettings = {
      enabledTools: state.enabledTools,
      ...state.writerSettings,
    };

    expect(savedSettings).toEqual({ enabledTools: ["search_lorebook"] });
    expect(savedSettings).not.toHaveProperty("lorebookWriteEnabled");
    expect(savedSettings).not.toHaveProperty("writableLorebookId");
    expect(savedSettings).not.toHaveProperty("writableLorebookIds");
  });
});
