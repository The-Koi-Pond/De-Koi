import { describe, expect, it } from "vitest";

import { PROFILE_IMPORT_DIALOG_FILTER, PROFILE_IMPORT_IDLE_LABEL } from "./ProfileImportSection";

describe("ProfileImportSection copy", () => {
  it("presents profile imports as De-Koi while accepting legacy file types", () => {
    expect(PROFILE_IMPORT_IDLE_LABEL).toBe("Import Profile (JSON/ZIP/DB)");
    expect(PROFILE_IMPORT_DIALOG_FILTER).toEqual({
      name: "De-Koi Profile",
      extensions: ["json", "zip", "db", "sqlite", "sqlite3"],
    });
  });
});
