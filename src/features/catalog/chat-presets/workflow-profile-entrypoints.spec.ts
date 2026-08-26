import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Roleplay workflow profile entry points", () => {
  it("mounts the public chooser as the final optional Roleplay wizard step and directly beneath the drawer preset bar", () => {
    const wizard = read("src/features/modes/shared/chat-ui/components/ChatSetupWizard.tsx");
    const drawer = read("src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx");
    const publicIndex = read("src/features/catalog/chat-presets/index.ts");
    const stepList = wizard.slice(wizard.indexOf("const ALL_STEPS"), wizard.indexOf("// ─── Main component"));
    const roleplayWizardStart = wizard.indexOf("function RoleplaySetupWizard");
    const roleplayWizardEnd = wizard.indexOf("const stepRenderers", roleplayWizardStart);
    expect(roleplayWizardStart).toBeGreaterThan(-1);
    expect(roleplayWizardEnd).toBeGreaterThan(roleplayWizardStart);
    const roleplayWizard = wizard.slice(roleplayWizardStart, roleplayWizardEnd);

    expect(publicIndex).toContain('export * from "./components/RoleplayWorkflowProfileChooser"');
    expect(publicIndex).toContain('export * from "./components/RoleplayWorkflowProfileDrawerControl"');
    expect(wizard).toContain('key: "workflow-profile"');
    expect(stepList.lastIndexOf("key:")).toBe(stepList.indexOf('key: "workflow-profile"'));
    expect(roleplayWizard).toContain('<RoleplayWorkflowProfileChooser chat={chat} entryPoint="wizard"');

    const workflowMount = drawer.slice(
      drawer.indexOf("{isRoleplayMode && (", drawer.indexOf("<ChatPresetBar")),
      drawer.indexOf('<div className="flex-1 overflow-y-auto">'),
    );
    expect(workflowMount).toContain("<RoleplayWorkflowProfileDrawerControl");
    expect(workflowMount).toContain("chat={chat}");
    expect(workflowMount).toContain('revealFromDiscovery={settingsDestination === "chat-settings-workflow-profile"}');
  });

  it("keeps Conversation and Game mode surfaces free of workflow-profile mounts", () => {
    const conversation = read("src/features/modes/conversation/components/ChatConversationSurface.tsx");
    const game = read("src/features/modes/game/components/GameSurface.tsx");

    expect(conversation).not.toContain("RoleplayWorkflowProfileChooser");
    expect(game).not.toContain("RoleplayWorkflowProfileChooser");
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

  it("widens only the workflow wizard step enough to reach the chooser container breakpoint", () => {
    const wizard = read("src/features/modes/shared/chat-ui/components/ChatSetupWizard.tsx");
    const chooser = read("src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.tsx");
    const drawer = read("src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx");
    const shortcutCardStart = wizard.indexOf('key="shortcut"');
    const standardCardStart = wizard.indexOf("key={step}");
    const shortcutCard = wizard.slice(shortcutCardStart, wizard.indexOf("{/* Header */}", shortcutCardStart));
    const standardCard = wizard.slice(standardCardStart, wizard.indexOf("{/* Sprite */}", standardCardStart));

    expect(shortcutCard).toContain("max-w-lg");
    expect(shortcutCard).not.toContain("max-w-4xl");
    expect(standardCard).toContain('currentStep.key === "workflow-profile" ? "max-w-lg sm:max-w-4xl" : "max-w-lg"');
    expect(standardCard).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(standardCard).toContain("overflow-hidden");
    expect(chooser).toContain("@[36rem]:grid-cols");
    expect(drawer).toContain("w-80");
  });
});
