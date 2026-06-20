import { createAgentConfigSchema, type CreateAgentConfigInput } from "../../../../engine/contracts/schemas/agent.schema";
import type { AgentPhase } from "../../../../engine/contracts/types/agent";
import type { AgentConfigRow } from "../hooks/use-agents";

export const AGENT_FOLDER_EXPORT_KIND = "marinara.agent-folder";
export const AGENT_MANIFEST_KIND = "marinara.agent";
const AGENT_EXPORT_VERSION = 1;

type AgentManifest = {
  kind: typeof AGENT_MANIFEST_KIND;
  version: typeof AGENT_EXPORT_VERSION;
  config: Record<string, unknown>;
};

type AgentFolderExport = {
  kind: typeof AGENT_FOLDER_EXPORT_KIND;
  version: typeof AGENT_EXPORT_VERSION;
  exportedAt: string;
  folderName: "Agents";
  agents: Array<{
    path: string;
    manifest: AgentManifest;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function readAgentPhase(value: unknown): AgentPhase {
  const normalized = readString(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "pre_generation" || normalized === "pre" || normalized === "before_generation") {
    return "pre_generation";
  }
  if (normalized === "parallel" || normalized === "during_generation") {
    return "parallel";
  }
  if (normalized === "post_processing" || normalized === "post" || normalized === "after_generation") {
    return "post_processing";
  }
  return "post_processing";
}

function parseSettings(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function slugifyAgentName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "agent"
  );
}

function readCustomAgentType(value: unknown): string {
  const type = readString(value);
  return /^custom-[a-z0-9][a-z0-9-]*$/.test(type) ? type : "";
}

export function createCustomAgentType(name: string): string {
  const suffix =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom-${slugifyAgentName(name)}-${suffix}`;
}

export function agentExportFilename(agent: Pick<AgentConfigRow, "name" | "type">): string {
  return `${slugifyAgentName(agent.name || agent.type)}.json`;
}

function buildAgentConfig(agent: AgentConfigRow): CreateAgentConfigInput {
  const settings = parseSettings(agent.settings);
  return createAgentConfigSchema.parse({
    type: agent.type,
    name: agent.name,
    description: agent.description ?? "",
    credit: agent.credit ?? "",
    phase: agent.phase,
    enabled: readBoolean(agent.enabled, true),
    connectionId: null,
    imagePath: null,
    promptTemplate: agent.promptTemplate ?? "",
    settings,
    ...(typeof settings.resultType === "string" ? { resultType: settings.resultType } : {}),
  });
}

export function buildAgentExportEnvelope(agent: AgentConfigRow, exportedAt = new Date().toISOString()): AgentFolderExport {
  const config = buildAgentConfig(agent);
  const type = readString(config.type) || createCustomAgentType(agent.name || agent.type);
  return {
    kind: AGENT_FOLDER_EXPORT_KIND,
    version: AGENT_EXPORT_VERSION,
    exportedAt,
    folderName: "Agents",
    agents: [
      {
        path: `Agents/${type}/manifest.json`,
        manifest: {
          kind: AGENT_MANIFEST_KIND,
          version: AGENT_EXPORT_VERSION,
          config,
        },
      },
    ],
  };
}

function normalizeAgentConfig(
  data: Record<string, unknown>,
  usedTypes: Set<string>,
): CreateAgentConfigInput {
  const name = readString(data.name) || "Imported Agent";
  const settings = parseSettings(data.settings);
  const resultType = readString(data.resultType);
  if (resultType && settings.resultType === undefined) {
    settings.resultType = resultType;
  }
  const exportedType = readCustomAgentType(data.type);
  if (!exportedType) {
    const rawType = readString(data.type);
    throw new Error(
      rawType
        ? `Agent type "${rawType}" is not a valid exported custom agent type.`
        : "Agent manifest is missing a custom agent type.",
    );
  }
  const payload = createAgentConfigSchema.parse({
    type: exportedType,
    name,
    description: readString(data.description),
    credit: readString(data.credit),
    imagePath: null,
    phase: readAgentPhase(data.phase ?? data.runPhase ?? data.executionPhase),
    enabled: readBoolean(data.enabled, true),
    connectionId: null,
    resultType: resultType || undefined,
    promptTemplate: typeof data.promptTemplate === "string" ? data.promptTemplate : "",
    settings,
  });
  if (usedTypes.has(payload.type)) {
    throw new Error(`Agent type "${payload.type}" already exists. Rename or delete the existing agent before import.`);
  }
  usedTypes.add(payload.type);
  return payload;
}

function manifestConfig(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (value.kind === AGENT_MANIFEST_KIND && value.version === AGENT_EXPORT_VERSION && isRecord(value.config)) {
    return value.config;
  }
  return null;
}

export function normalizeAgentImportPayloads(
  value: unknown,
  existingTypes: Iterable<string> = [],
): CreateAgentConfigInput[] {
  const root = isRecord(value) ? value : null;
  if (!root) throw new Error("Agent import file must contain a JSON object.");
  const usedTypes = existingTypes instanceof Set ? existingTypes : new Set(existingTypes);

  if (root.kind === AGENT_FOLDER_EXPORT_KIND && root.version === AGENT_EXPORT_VERSION) {
    if (!Array.isArray(root.agents) || root.agents.length === 0) {
      throw new Error("Agent folder export does not contain any agents.");
    }
    return root.agents.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`Agent entry ${index + 1} is not an object.`);
      const config = manifestConfig(entry.manifest);
      if (!config) throw new Error(`Agent entry ${index + 1} is missing a Marinara agent manifest.`);
      return normalizeAgentConfig(config, usedTypes);
    });
  }

  const config = manifestConfig(root);
  if (config) return [normalizeAgentConfig(config, usedTypes)];

  throw new Error("Unsupported agent import format. Expected a Marinara agent folder export.");
}

export function normalizeAgentImportPayload(
  value: unknown,
  existingTypes: Iterable<string> = [],
): CreateAgentConfigInput {
  const payloads = normalizeAgentImportPayloads(value, existingTypes);
  if (payloads.length !== 1) {
    throw new Error(`Expected a single agent manifest but found ${payloads.length}.`);
  }
  return payloads[0];
}
