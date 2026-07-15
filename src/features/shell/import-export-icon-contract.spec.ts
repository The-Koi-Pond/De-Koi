import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("import and export icon direction", () => {
  it("uses Download for incoming memory and chat-preset imports and Upload for exports", () => {
    const memories = readSource(
      "src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.tsx",
    );
    const presets = readSource("src/features/modes/shared/chat-ui/components/settings/ChatPresetBar.tsx");

    expect(memories).toMatch(/title="Export memories"[\s\S]{0,240}<Upload/);
    expect(memories).toMatch(/title="Import memories"[\s\S]{0,300}<Download/);
    expect(presets).toMatch(/title="Import preset \(\.json\)"[\s\S]{0,240}<Download/);
    expect(presets).toMatch(/title="Export preset \(\.json\)"[\s\S]{0,400}<Upload/);
  });

  it("uses Upload for outgoing chat files and Download for incoming chat files", () => {
    const files = readSource("src/features/modes/shared/chat-ui/components/ChatFilesDrawer.tsx");

    expect(files).toMatch(/Export[\s\S]{0,700}<Upload/);
    expect(files).toMatch(/Import[\s\S]{0,650}<Download/);
  });
});
