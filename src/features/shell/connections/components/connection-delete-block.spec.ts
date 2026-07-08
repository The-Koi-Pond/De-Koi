import { describe, expect, it } from "vitest";
import { ApiError } from "../../../../shared/api/api-errors";
import {
  connectionDeleteBlockFromError,
  formatConnectionDeleteBlockMessage,
  formatConnectionForceDeleteFailureMessage,
} from "./connection-delete-block";

describe("connection delete block dialog", () => {
  it("formats attached chats with a cap and consequence warning", () => {
    expect(
      formatConnectionDeleteBlockMessage(
        [
          { id: "chat-1", name: "Harbor" },
          { id: "chat-2", name: "Moon Gate" },
          { id: "chat-3", name: "Archive" },
          { id: "chat-4", name: "Unlisted" },
        ],
        2,
      ),
    ).toBe(
      "This connection is still attached to these chats:\n\n- Harbor\n- Moon Gate\n- and 2 more\n\nDelete anyway? These chats will lose their connection and stop working until reassigned.",
    );
  });

  it("formats forced delete failures as an explicit stale-state warning", () => {
    expect(formatConnectionForceDeleteFailureMessage(new Error("database busy"))).toBe(
      "Forced delete failed. The connection may still exist; De-Koi is refreshing attached chats and agents. database busy",
    );
  });
  it("extracts attached chats from connection_in_use ApiError details", () => {
    const error = new ApiError("Connection in use", 409, {
      code: "connection_in_use",
      chats: [{ id: "chat-1", name: "Harbor" }],
      agents: [{ id: "agent-1", name: "Director" }],
    });

    expect(connectionDeleteBlockFromError(error)).toEqual({
      chats: [{ id: "chat-1", name: "Harbor" }],
      agents: [{ id: "agent-1", name: "Director" }],
    });
  });
});
