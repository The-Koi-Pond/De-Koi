import {
  DEFAULT_MODEL_ROUTING_SETTINGS,
  MODEL_ROUTING_SETTINGS_ID,
  normalizeModelRoutingSettings,
  readModelRoutingSettings,
  type ModelRouteTask,
  type ModelRoutingSettings,
} from "../../engine/generation/model-routing";
import { transformAppSettings } from "./app-settings-api";
import { storageApi } from "./storage-api";

/**
 * Sets (or with null, clears) the connection for one helper task. The write is
 * compare-and-set, so another client's change to a different task is kept.
 */
async function setRoute(task: ModelRouteTask, connectionId: string | null): Promise<ModelRoutingSettings> {
  const value = await transformAppSettings(MODEL_ROUTING_SETTINGS_ID, "helper models", (stored, exists) => {
    const current = exists ? normalizeModelRoutingSettings(stored) : DEFAULT_MODEL_ROUTING_SETTINGS;
    const routes = { ...current.routes };
    if (connectionId) routes[task] = connectionId;
    else delete routes[task];
    return { version: 1, routes } satisfies ModelRoutingSettings;
  });
  return normalizeModelRoutingSettings(value);
}

export const modelRoutingKeys = {
  settings: ["model-routing"] as const,
};

export const modelRoutingApi = {
  get: () => readModelRoutingSettings(storageApi),
  setRoute,
};
