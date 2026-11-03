import {
  DEFAULT_MODEL_ROUTING_SETTINGS,
  MODEL_ROUTE_TASKS,
  MODEL_ROUTING_SETTINGS_ID,
  normalizeModelRoutingSettings,
  readModelRoutingSettings,
  type ModelRouteTask,
  type ModelRoutingSettings,
} from "../../engine/generation/model-routing";
import { readHelperRuns } from "../../engine/generation/helper-runs";
import { transformAppSettings } from "./app-settings-api";
import { storageApi } from "./storage-api";

/** Each write is compare-and-set, so another client's change to a different task is kept. */
async function updateSettings(
  edit: (current: ModelRoutingSettings) => ModelRoutingSettings,
): Promise<ModelRoutingSettings> {
  const value = await transformAppSettings(MODEL_ROUTING_SETTINGS_ID, "helper models", (stored, exists) => {
    const next = edit(exists ? normalizeModelRoutingSettings(stored) : DEFAULT_MODEL_ROUTING_SETTINGS);
    return normalizeModelRoutingSettings(next);
  });
  return normalizeModelRoutingSettings(value);
}

/** Sets (or with null, clears) the connection for one helper task. */
function setRoute(task: ModelRouteTask, connectionId: string | null): Promise<ModelRoutingSettings> {
  return updateSettings((current) => {
    const routes = { ...current.routes };
    if (connectionId) routes[task] = connectionId;
    else delete routes[task];
    return { ...current, routes };
  });
}

/** Marks (or unmarks) one helper task as one that must stay on this device or network. */
function setLocalOnly(task: ModelRouteTask, localOnly: boolean): Promise<ModelRoutingSettings> {
  return updateSettings((current) => {
    const marked = new Set(current.localOnly ?? []);
    if (localOnly) marked.add(task);
    else marked.delete(task);
    return { ...current, localOnly: MODEL_ROUTE_TASKS.filter((entry) => marked.has(entry)) };
  });
}

export const modelRoutingKeys = {
  settings: ["model-routing"] as const,
  /** Where each helper last ran and why (Helper Models, and the fic panels). */
  runs: ["model-routing", "runs"] as const,
};

export const modelRoutingApi = {
  get: () => readModelRoutingSettings(storageApi),
  runs: () => readHelperRuns(storageApi),
  setRoute,
  setLocalOnly,
};
