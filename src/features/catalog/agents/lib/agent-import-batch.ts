import type { CreateAgentConfigInput } from "../../../../engine/contracts/schemas/agent.schema";

export type StagedAgentImportPayload = {
  fileName: string;
  payload: CreateAgentConfigInput;
};

export type AgentImportBatchResult = {
  atomic: boolean;
  imported: number;
  failures: string[];
  created: Array<{ fileName: string; name: string; id: string }>;
  kept: Array<{ fileName: string; name: string; id: string }>;
  rolledBack: Array<{ fileName: string; name: string; id: string }>;
  outcomes: AgentImportBatchOutcome[];
};

type AgentImportBatchOutcome =
  | { status: "imported"; fileName: string; name: string; id: string }
  | { status: "failed"; fileName: string; name: string; message: string }
  | { status: "rolled_back"; fileName: string; name: string; id: string }
  | { status: "rollback_failed"; fileName: string; name: string; id: string; message: string }
  | { status: "not_attempted"; fileName: string; name: string; message: string };

type CreatedAgent = {
  id?: unknown;
};

type CreatedImport = {
  index: number;
  fileName: string;
  name: string;
  id: string;
};

function outcomeFailure(outcome: AgentImportBatchOutcome): string | null {
  switch (outcome.status) {
    case "failed":
      return `${outcome.fileName} / ${outcome.name}: ${outcome.message}`;
    case "rollback_failed":
      return `${outcome.fileName} / ${outcome.name}: rollback failed for ${outcome.id}: ${outcome.message}`;
    case "not_attempted":
      return `${outcome.fileName} / ${outcome.name}: ${outcome.message}`;
    case "imported":
    case "rolled_back":
      return null;
  }
}

function resultFromOutcomes(outcomes: AgentImportBatchOutcome[]): AgentImportBatchResult {
  const created = outcomes
    .filter((outcome): outcome is Extract<AgentImportBatchOutcome, { status: "imported" }> =>
      outcome.status === "imported",
    )
    .map(({ fileName, name, id }) => ({ fileName, name, id }));
  const kept = outcomes
    .filter((outcome): outcome is Extract<AgentImportBatchOutcome, { status: "rollback_failed" }> =>
      outcome.status === "rollback_failed",
    )
    .map(({ fileName, name, id }) => ({ fileName, name, id }));
  const rolledBack = outcomes
    .filter((outcome): outcome is Extract<AgentImportBatchOutcome, { status: "rolled_back" }> =>
      outcome.status === "rolled_back",
    )
    .map(({ fileName, name, id }) => ({ fileName, name, id }));
  const failures = outcomes.map(outcomeFailure).filter((failure): failure is string => Boolean(failure));
  return { atomic: kept.length === 0, imported: created.length, failures, created, kept, rolledBack, outcomes };
}

export async function commitAgentImportBatch(
  stagedPayloads: StagedAgentImportPayload[],
  createAgent: (payload: CreateAgentConfigInput) => Promise<CreatedAgent>,
  deleteAgent: (id: string) => Promise<unknown>,
): Promise<AgentImportBatchResult> {
  const outcomes: AgentImportBatchOutcome[] = [];
  const created: CreatedImport[] = [];

  for (let index = 0; index < stagedPayloads.length; index += 1) {
    const { fileName, payload } = stagedPayloads[index];
    try {
      const createdAgent = await createAgent(payload);
      if (typeof createdAgent.id !== "string") {
        throw new Error("Imported agent did not return an id");
      }
      created.push({ index, fileName, name: payload.name, id: createdAgent.id });
      outcomes[index] = { status: "imported", fileName, name: payload.name, id: createdAgent.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import agent";
      outcomes[index] = { status: "failed", fileName, name: payload.name, message };
      for (let skippedIndex = index + 1; skippedIndex < stagedPayloads.length; skippedIndex += 1) {
        const skipped = stagedPayloads[skippedIndex];
        outcomes[skippedIndex] = {
          status: "not_attempted",
          fileName: skipped.fileName,
          name: skipped.payload.name,
          message: "not attempted because an earlier import failed",
        };
      }
      break;
    }
  }

  if (outcomes.every((outcome) => outcome?.status === "imported")) {
    return resultFromOutcomes(outcomes);
  }

  for (const createdAgent of created) {
    try {
      await deleteAgent(createdAgent.id);
      outcomes[createdAgent.index] = {
        status: "rolled_back",
        fileName: createdAgent.fileName,
        name: createdAgent.name,
        id: createdAgent.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to roll back imported agent";
      outcomes[createdAgent.index] = {
        status: "rollback_failed",
        fileName: createdAgent.fileName,
        name: createdAgent.name,
        id: createdAgent.id,
        message,
      };
    }
  }

  return resultFromOutcomes(outcomes);
}
