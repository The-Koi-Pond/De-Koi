import { describe, expect, it } from "vitest";
import {
  AGENT_FOLDER_EXPORT_KIND,
  AGENT_MANIFEST_KIND,
  buildAgentExportEnvelope,
  normalizeAgentImportPayload,
  normalizeAgentImportPayloads,
} from "./agent-import-export";
import type { AgentConfigRow } from "../hooks/use-agents";

function agentRow(overrides: Partial<AgentConfigRow> = {}): AgentConfigRow {
  return {
    id: "agent-1",
    type: "custom-plotter-abc",
    name: "Plotter",
    description: "Plans twists.",
    credit: "Max",
    phase: "pre_generation",
    enabled: true,
    connectionId: "connection-1",
    promptTemplate: "Find the next beat.",
    settings: JSON.stringify({ resultType: "context_injection", enabledTools: ["search_lorebook"] }),
    imagePath: "/api/agents/images/file/plotter.png",
    createdAt: "2026-06-20T00:00:00Z",
    updatedAt: "2026-06-20T00:00:00Z",
    ...overrides,
  };
}

describe("agent import/export", () => {
  it("exports a standalone Marinara agent envelope with persisted agent fields", () => {
    const envelope = buildAgentExportEnvelope(agentRow(), "2026-06-20T12:00:00.000Z");

    expect(envelope).toEqual({
      kind: AGENT_FOLDER_EXPORT_KIND,
      version: 1,
      exportedAt: "2026-06-20T12:00:00.000Z",
      folderName: "Agents",
      agents: [
        {
          path: "Agents/custom-plotter-abc/manifest.json",
          manifest: {
            kind: AGENT_MANIFEST_KIND,
            version: 1,
            config: {
              type: "custom-plotter-abc",
              name: "Plotter",
              description: "Plans twists.",
              credit: "Max",
              imagePath: null,
              phase: "pre_generation",
              enabled: true,
              connectionId: null,
              promptTemplate: "Find the next beat.",
              settings: { resultType: "context_injection", enabledTools: ["search_lorebook"] },
              resultType: "context_injection",
            },
          },
        },
      ],
    });
  });

  it("imports an agent folder export as a new custom agent payload", () => {
    const imported = normalizeAgentImportPayload(buildAgentExportEnvelope(agentRow(), "2026-06-20T12:00:00.000Z"));

    expect(imported).toEqual({
      type: "custom-plotter-abc",
      name: "Plotter",
      description: "Plans twists.",
      credit: "Max",
      imagePath: null,
      phase: "pre_generation",
      enabled: true,
      connectionId: null,
      resultType: "context_injection",
      promptTemplate: "Find the next beat.",
      settings: { resultType: "context_injection", enabledTools: ["search_lorebook"] },
    });
  });

  it("rejects an exported custom type collision instead of silently reminting identity", () => {
    expect(() =>
      normalizeAgentImportPayload(
        buildAgentExportEnvelope(agentRow(), "2026-06-20T12:00:00.000Z"),
        new Set(["custom-plotter-abc"]),
      ),
    ).toThrow('Agent type "custom-plotter-abc" already exists.');
  });

  it("tracks imported types across separate file normalizations", () => {
    const usedTypes = new Set<string>();

    normalizeAgentImportPayload(buildAgentExportEnvelope(agentRow(), "2026-06-20T12:00:00.000Z"), usedTypes);

    expect(() =>
      normalizeAgentImportPayload(buildAgentExportEnvelope(agentRow(), "2026-06-20T12:00:00.000Z"), usedTypes),
    ).toThrow('Agent type "custom-plotter-abc" already exists.');
  });

  it("round-trips exported persisted fields through the import contract", () => {
    const imported = normalizeAgentImportPayload(
      buildAgentExportEnvelope(
        agentRow({
          credit: "Imported Author",
          enabled: false,
          connectionId: null,
          settings: JSON.stringify({ resultType: "text_rewrite", maxTokens: 256 }),
        }),
        "2026-06-20T12:00:00.000Z",
      ),
    );

    expect(imported).toEqual({
      type: "custom-plotter-abc",
      name: "Plotter",
      description: "Plans twists.",
      credit: "Imported Author",
      imagePath: null,
      phase: "pre_generation",
      enabled: false,
      connectionId: null,
      resultType: "text_rewrite",
      promptTemplate: "Find the next beat.",
      settings: { resultType: "text_rewrite", maxTokens: 256 },
    });
  });

  it("imports the M.E. agent folder shape without emptying fields", () => {
    const imported = normalizeAgentImportPayloads(
      {
        kind: "marinara.agent-folder",
        version: 1,
        exportedAt: "2026-06-20T14:35:03.670Z",
        folderName: "Agents",
        agents: [
          {
            path: "Agents/custom-efp-tracker/manifest.json",
            manifest: {
              kind: "marinara.agent",
              version: 1,
              config: {
                type: "custom-efp-tracker",
                name: "EFP Tracker",
                description: "Infers the user's likely emotional state.",
                credit: "Chai",
                phase: "pre_generation",
                enabled: true,
                connectionId: null,
                imagePath: null,
                promptTemplate: "You are a hidden pre-generation scene-direction agent.",
                settings: {
                  author: "Chai",
                  resultType: "context_injection",
                  contextSize: 8,
                  maxTokens: 512,
                  runInterval: 1,
                  enabledTools: [],
                },
                resultType: "context_injection",
              },
            },
          },
        ],
      },
    );

    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      type: "custom-efp-tracker",
      name: "EFP Tracker",
      description: "Infers the user's likely emotional state.",
      credit: "Chai",
      phase: "pre_generation",
      enabled: true,
      promptTemplate: "You are a hidden pre-generation scene-direction agent.",
      settings: {
        author: "Chai",
        resultType: "context_injection",
        contextSize: 8,
        maxTokens: 512,
        runInterval: 1,
        enabledTools: [],
      },
    });
  });

  it("rejects exported manifests without a valid custom type instead of reminting identity", () => {
    const envelope = buildAgentExportEnvelope(agentRow({ type: "custom-plotter-abc" }), "2026-06-20T12:00:00.000Z");
    envelope.agents[0].manifest.config.type = "plotter";

    expect(() => normalizeAgentImportPayload(envelope)).toThrow(
      'Agent type "plotter" is not a valid exported custom agent type.',
    );
  });

  it("rejects multi-agent folders through the single-agent helper", () => {
    const first = buildAgentExportEnvelope(agentRow({ type: "custom-plotter-abc" }), "2026-06-20T12:00:00.000Z");
    const second = buildAgentExportEnvelope(
      agentRow({ id: "agent-2", type: "custom-editor-def", name: "Editor" }),
      "2026-06-20T12:00:00.000Z",
    );
    first.agents.push(second.agents[0]);

    expect(() => normalizeAgentImportPayload(first)).toThrow("Expected a single agent manifest but found 2.");
  });
});
