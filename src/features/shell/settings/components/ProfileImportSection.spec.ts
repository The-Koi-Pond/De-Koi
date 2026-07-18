import { describe, expect, it } from "vitest";

import {
  formatProfileImportConfirmationMessage,
  PROFILE_IMPORT_DIALOG_FILTER,
  PROFILE_IMPORT_IDLE_LABEL,
} from "./ProfileImportSection";

describe("ProfileImportSection copy", () => {
  it("presents profile imports as De-Koi while accepting legacy file types", () => {
    expect(PROFILE_IMPORT_IDLE_LABEL).toBe("Import Profile (JSON/ZIP/DB)");
    expect(PROFILE_IMPORT_DIALOG_FILTER).toEqual({
      name: "De-Koi Profile",
      extensions: ["json", "zip", "db", "sqlite", "sqlite3"],
    });
  });

  it("names the destructive scope from a v2 package before confirmation", () => {
    expect(
      formatProfileImportConfirmationMessage({
        sourceFormat: "profile-v2",
        imported: { characters: 2, messages: 4 },
        destructiveScopes: ["characters", "messages", "managed assets"],
      }),
    ).toContain("Will replace: characters, messages, managed assets.");
  });
});
