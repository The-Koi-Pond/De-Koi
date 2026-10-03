import { appSettingsResponseSchema, appSettingsUpdateSchema } from "../../engine/contracts/schemas/app-settings.schema";
import { isDuplicateCreateError } from "./api-errors";
import { storageApi } from "./storage-api";

const SETTINGS_WRITE_ATTEMPTS = 5;

/**
 * The server cannot do what this app needs and must be updated. Its message is
 * fixed app copy that tells the user what to do, so the UI shows it as is.
 */
class OutdatedServerError extends Error {
  override name = "OutdatedServerError";
}

const CONDITIONAL_SETTINGS_COMMAND = "app_settings_update_if_unchanged";

/**
 * Writes `value` to app-settings row `id` only if its stored value still equals
 * `expectedValue`. True when the write landed; false when another write changed
 * the row first. `label` names the settings in errors ("Deki settings").
 */
export async function updateAppSettingsIfUnchanged(
  id: string,
  expectedValue: unknown,
  value: unknown,
  label: string,
): Promise<boolean> {
  const updateIfUnchanged = storageApi.updateAppSettingsIfUnchanged;
  if (!updateIfUnchanged) throw new Error("This storage gateway cannot update settings conditionally.");
  try {
    return (await updateIfUnchanged.call(storageApi, id, expectedValue, value)).updated;
  } catch (error) {
    // A remote runtime older than this app has no conditional update. A plain
    // write there could replace another client's change, so refuse without
    // writing and say how to fix it.
    if (
      error instanceof Error &&
      error.message === `${CONDITIONAL_SETTINGS_COMMAND} is not exposed by the remote runtime`
    ) {
      throw new OutdatedServerError(
        `This De-Koi server is older than the app and cannot save ${label} safely. Update and restart the server, then try again.`,
      );
    }
    throw error;
  }
}

/**
 * Reads app-settings row `id`, applies `transform` to its stored value, and
 * writes the result only if the row has not changed since the read. A write
 * that lost to another client re-reads and re-applies `transform` on top of
 * theirs, so no concurrent change is silently replaced. `exists` tells the
 * transform whether the row was there, for callers with their own defaults.
 * Returns the value written.
 */
export async function transformAppSettings(
  id: string,
  label: string,
  transform: (value: unknown, exists: boolean) => unknown,
): Promise<unknown> {
  for (let attempt = 0; attempt < SETTINGS_WRITE_ATTEMPTS; attempt += 1) {
    const existing = await storageApi.get<{ value?: unknown }>("app-settings", id);
    const parsed = appSettingsResponseSchema.safeParse(existing ?? { value: null });
    const payload = appSettingsUpdateSchema.parse({
      value: transform(parsed.success ? parsed.data.value : null, Boolean(existing)),
    });
    if (existing) {
      if (await updateAppSettingsIfUnchanged(id, existing.value ?? null, payload.value, label)) return payload.value;
      continue;
    }
    try {
      await storageApi.create("app-settings", { id, ...payload });
    } catch (error) {
      // Another client created the row after this one read it; apply this
      // change on top of that row on the next attempt.
      if (!isDuplicateCreateError(error, "app-settings", id)) throw error;
      continue;
    }
    return payload.value;
  }
  throw new Error(`${label[0]?.toUpperCase() ?? ""}${label.slice(1)} kept changing while saving. Try again.`);
}
