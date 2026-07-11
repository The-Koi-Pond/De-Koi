export type ConnectionModelMetadata = {
  id: string;
  name?: string;
  context?: number | null;
  maxOutput?: number | null;
  fallback?: boolean;
};

export type MergedConnectionModel = {
  id: string;
  name: string;
  context: number | null;
  maxOutput: number | null;
  isRemote: boolean;
  fallback?: boolean;
};

function positiveLimit(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function mergeConnectionModels(
  remoteModels: ConnectionModelMetadata[],
  knownModels: ConnectionModelMetadata[],
): MergedConnectionModel[] {
  const knownById = new Map(knownModels.map((model) => [model.id, model]));
  const remoteIds = new Set(remoteModels.map((model) => model.id));
  const remote = remoteModels.map((model) => {
    const known = knownById.get(model.id);
    return {
      id: model.id,
      name: model.name || known?.name || model.id,
      context: positiveLimit(model.context) ?? positiveLimit(known?.context),
      maxOutput: positiveLimit(model.maxOutput) ?? positiveLimit(known?.maxOutput),
      isRemote: true,
      fallback: model.fallback,
    };
  });
  const known = knownModels
    .filter((model) => !remoteIds.has(model.id))
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      context: positiveLimit(model.context),
      maxOutput: positiveLimit(model.maxOutput),
      isRemote: false,
      fallback: model.fallback,
    }));
  return [...remote, ...known];
}

export function selectConnectionModelLimits(model: {
  id: string;
  context?: number | null;
  maxOutput?: number | null;
}) {
  return {
    maxContext: positiveLimit(model.context),
    maxTokensOverride: positiveLimit(model.maxOutput),
  };
}

export function selectConnectionModel(model: {
  id: string;
  context?: number | null;
  maxOutput?: number | null;
}) {
  return {
    modelId: model.id,
    searchQuery: "",
    ...selectConnectionModelLimits(model),
  };
}
