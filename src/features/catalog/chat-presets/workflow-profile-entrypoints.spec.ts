import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Roleplay workflow profile entry points", () => {
  // The setup wizard's workflow step is covered by behavior tests in ChatSetupWizard.spec.tsx.
  it("mounts the public chooser directly beneath the drawer preset bar", () => {
    const drawer = read("src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx");
    const publicIndex = read("src/features/catalog/chat-presets/index.ts");

    expect(publicIndex).toContain('export * from "./components/RoleplayWorkflowProfileChooser"');
    expect(publicIndex).toContain('export * from "./components/RoleplayWorkflowProfileDrawerControl"');

    const workflowMount = drawer.slice(
      drawer.indexOf("{isRoleplayMode && (", drawer.indexOf("<ChatPresetBar")),
      drawer.indexOf('<div className="flex-1 overflow-y-auto">'),
    );
    expect(workflowMount).toContain("<RoleplayWorkflowProfileDrawerControl");
    expect(workflowMount).toContain("chat={chat}");
    expect(workflowMount).toContain('revealFromDiscovery={settingsDestination === "chat-settings-workflow-profile"}');
  });

  it("keeps Conversation and Fanfic mode surfaces free of workflow-profile mounts", () => {
    const conversation = read("src/features/modes/conversation/components/ChatConversationSurface.tsx");
    const fanfic = read("src/features/modes/fanfic/components/FanficModeRoute.tsx");

    expect(conversation).not.toContain("RoleplayWorkflowProfileChooser");
    expect(fanfic).not.toContain("RoleplayWorkflowProfileChooser");
  });

  it("provides stable Prompt Preset, Continuity, Agents, and workflow chooser targets", () => {
    const basic = read("src/features/modes/shared/chat-ui/components/settings/ChatBasicSettingsSections.tsx");
    const drawer = read("src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx");
    const drawerControl = read("src/features/catalog/chat-presets/components/RoleplayWorkflowProfileDrawerControl.tsx");

    expect(basic).toContain('id="chat-settings-prompt-preset"');
    expect(drawer).toContain('id="chat-settings-continuity"');
    expect(drawer).toContain('id="chat-settings-agents"');
    expect(drawerControl).toContain('id="chat-settings-workflow-profile"');
  });

  it("uses the same live capability resolver for preview and the immediate pre-apply check", () => {
    const chooser = read("src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.tsx");

    expect(chooser).toContain("resolveRoleplayWorkflowCapabilities(displayedChat)");
    expect(chooser).toContain("resolveCapabilities: resolveRoleplayWorkflowCapabilities");
  });

  it("passes the discovery destination through the existing Roleplay overlay lifecycle", () => {
    const overlays = read("src/features/modes/shared/chat-ui/hooks/use-chat-overlays.ts");
    const route = read("src/features/modes/roleplay/components/RoleplayModeRoute.tsx");
    const surface = read("src/features/modes/roleplay/components/ChatRoleplaySurface.tsx");
    const common = read("src/features/modes/shared/chat-ui/components/ChatCommonOverlays.tsx");

    expect(overlays).toContain("pendingDiscoverySection,");
    expect(route).toContain("settingsDestination={overlays.pendingDiscoverySection}");
    expect(surface).toContain("settingsDestination={settingsDestination}");
    expect(common).toContain("settingsDestination={settingsDestination}");
  });

  it("lays the chooser out by its own container width", () => {
    const chooser = read("src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.tsx");
    const drawer = read("src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx");

    expect(chooser).toContain("@[36rem]:grid-cols");
    expect(drawer).toContain("w-80");
  });
});
