import type { SetupReadinessFacts } from "../../../../engine/onboarding";
import type { RemoteRuntimeHealthCheck } from "../../../../shared/api/remote-runtime";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";

type RuntimeHealthView = RemoteRuntimeHealthCheck | { status: "checking"; message: string };

export interface SetupConnectionFact {
  id: string;
  provider?: string | null;
  model?: string | null;
}

export interface BuildSetupReadinessInput {
  embedded: boolean;
  runtimeUrl?: string | null;
  runtimeHealth?: RuntimeHealthView | null;
  connections?: readonly SetupConnectionFact[] | null;
  selectedConnectionId?: string | null;
  connectionTestCapability?: "available" | "unavailable";
  testedConnectionIds?: readonly string[];
}

function isUsableLanguageConnection(connection: SetupConnectionFact): boolean {
  const provider = connection.provider?.trim().toLowerCase();
  return !!connection.id?.trim() && provider !== "tts" && provider !== "text_to_speech";
}

export function buildSetupReadinessFacts(input: BuildSetupReadinessInput): SetupReadinessFacts {
  const usableConnections = filterLanguageGenerationConnections(input.connections).filter(isUsableLanguageConnection);
  const selected = input.selectedConnectionId
    ? usableConnections.find((connection) => connection.id === input.selectedConnectionId)
    : usableConnections[0];
  const testPassed = !!selected && (
    input.connectionTestCapability !== "available" || input.testedConnectionIds?.includes(selected.id) === true
  );

  let runtimeHealth: SetupReadinessFacts["runtimeHealth"] = "not-required";
  if (!input.embedded) {
    runtimeHealth = input.runtimeHealth?.status === "ok" && input.runtimeHealth.health.writable !== false
      ? "healthy"
      : input.runtimeHealth && input.runtimeHealth.status !== "checking" && input.runtimeHealth.status !== "unconfigured"
        ? "error"
        : "unknown";
  }

  return {
    environment: input.embedded ? "embedded" : "web",
    runtimeUrl: input.runtimeUrl?.trim() || null,
    runtimeHealth,
    usableConnectionCount: usableConnections.length,
    selectedConnectionTest: selected ? (testPassed ? "passed" : "required") : "not-selected",
  };
}
