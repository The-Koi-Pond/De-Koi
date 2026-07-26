import { beforeEach, describe, expect, it, vi } from "vitest";

import { showConfirmDialogWithOption } from "../../../../shared/lib/app-dialogs";
import { confirmChatDeletion } from "./chat-delete-confirmation";

vi.mock("../../../../shared/lib/app-dialogs", () => ({
  showConfirmDialogWithOption: vi.fn(),
}));

describe("confirmChatDeletion", () => {
  beforeEach(() => vi.mocked(showConfirmDialogWithOption).mockReset());

  it.each([
    [1, "Also delete cross-chat memories learned only from this chat"],
    [3, "Also delete cross-chat memories learned only from these chats"],
  ])("uses the safe unchecked ownership choice for %i chat(s)", async (count, optionLabel) => {
    vi.mocked(showConfirmDialogWithOption).mockResolvedValue({
      confirmed: true,
      optionChecked: false,
    });

    await expect(confirmChatDeletion(count)).resolves.toEqual({
      confirmed: true,
      deleteMemories: false,
    });
    expect(showConfirmDialogWithOption).toHaveBeenCalledWith(
      expect.objectContaining({
        optionLabel,
        defaultChecked: false,
      }),
    );
  });
});
