import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CoreModuleRuntimeProvider", () => {
  it("does not statically import ME Notes runtime code", () => {
    const providerSource = readFileSync(
      join(process.cwd(), "src/features/shell/plugins/components/CoreModuleRuntimeProvider.tsx"),
      "utf8",
    );

    expect(providerSource).not.toContain('import { MeNotepadModule } from "../notepad/MeNotepadModule"');
    expect(providerSource).toContain('import("../notepad/MeNotepadModule")');
    expect(providerSource).not.toContain("<Suspense fallback={null}>");
    expect(providerSource).toContain("CoreModuleFallback");
    expect(providerSource).toContain("onRetry");
    expect(providerSource).toContain("useMemo(createMeNotepadModule");
  });
});
