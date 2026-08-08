import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

function readAppSource() {
  return readFileSync(join(currentDir, "App.tsx"), "utf8");
}

function readViteConfigSource() {
  return readFileSync(join(currentDir, "../../vite.config.ts"), "utf8");
}

function readChatHooksSource() {
  return readFileSync(join(currentDir, "../features/catalog/chats/hooks/use-chats.ts"), "utf8");
}

function readChatSidebarEntrySource() {
  return readFileSync(join(currentDir, "../features/catalog/chats/sidebar.ts"), "utf8");
}

function readChatQueryOptionsSource() {
  return readFileSync(join(currentDir, "../features/catalog/chats/chat-query-options.ts"), "utf8");
}

function readPromptPreviewHookSource() {
  return readFileSync(join(currentDir, "../features/modes/shared/chat-ui/hooks/use-peek-prompt.ts"), "utf8");
}

function readTimelineActionsSource() {
  return readFileSync(join(currentDir, "../features/modes/shared/chat-ui/hooks/use-chat-timeline-actions.ts"), "utf8");
}

function readAppShellSource() {
  return readFileSync(join(currentDir, "shell/AppShell.tsx"), "utf8");
}

function readMemoryMaintenanceStartupSource() {
  return readFileSync(join(currentDir, "startup/AutomaticMemoryMaintenanceStartup.tsx"), "utf8");
}

describe("app boot shell boundary", () => {
  it("keeps lazy drag-and-drop dependencies separate from eager motion dependencies", () => {
    const source = readViteConfigSource();

    expect(source).toContain('"vendor-motion": ["framer-motion", "motion"]');
    expect(source).toContain('"vendor-dnd": ["@dnd-kit"]');
    expect(source).not.toContain('"vendor-ui": ["framer-motion", "motion", "@dnd-kit"]');
  });

  it("keeps the root App module free of deferred shell and feature imports", () => {
    const source = readAppSource();

    expect(source).toContain("lazy(");
    expect(source).toContain('import("./AppExperience")');
    expect(source).not.toMatch(/from\s+["']\.\/shell\//);
    expect(source).not.toMatch(/from\s+["']\.\.\/features\//);
    expect(source).not.toMatch(/from\s+["']\.\.\/shared\/api\/settings-assets-api/);
    expect(source).not.toMatch(/from\s+["']sonner["']/);
  });

  it("keeps the prompt preview engine out of the initial application bundle", () => {
    const chatHooksSource = readChatHooksSource();
    const previewHookSource = readPromptPreviewHookSource();
    const timelineActionsSource = readTimelineActionsSource();

    expect(chatHooksSource).not.toContain("prompt-preview");
    expect(previewHookSource).toContain('from "../../../../../engine/generation/prompt-preview"');
    expect(timelineActionsSource).toContain('from "./use-peek-prompt"');
  });

  it("keeps predictive chat queries out of the broad chat hook bundle", () => {
    const sidebarSource = readChatSidebarEntrySource();
    const queryOptionsSource = readChatQueryOptionsSource();

    expect(sidebarSource).toContain('from "./chat-query-options"');
    expect(sidebarSource).not.toContain('from "./hooks/use-chats"');
    expect(queryOptionsSource).not.toContain("hooks/use-chats");
    expect(queryOptionsSource).not.toContain("engine/generation");
  });

  it("keeps automatic memory maintenance behind an idle lazy boundary", () => {
    const shellSource = readAppShellSource();
    const startupSource = readMemoryMaintenanceStartupSource();

    expect(shellSource).not.toContain('from "../startup/automatic-memory-maintenance"');
    expect(startupSource).toContain('import("./automatic-memory-maintenance")');
    expect(startupSource).toContain("requestIdleCallback");
  });
});
