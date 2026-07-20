import { registerAppCloseGuard, type AppCloseGuard } from "../../../../shared/lib/app-close-guard";
import { gameInputDrafts } from "./game-input-drafts";

interface PendingGameDraftReader {
  hasUnsavedMemoryWork: () => boolean;
}

type AppCloseGuardRegistrar = (guard: AppCloseGuard) => unknown;

export function createGameInputDraftCloseGuardInstaller(
  drafts: PendingGameDraftReader,
  register: AppCloseGuardRegistrar,
) {
  let installed = false;

  return () => {
    if (installed) return;
    register({
      label: "Game turn attachments",
      hasPendingWork: () => drafts.hasUnsavedMemoryWork(),
      message: "Unsent game attachments are still in memory. Close anyway and lose those attachments?",
      purposes: ["app-close"],
    });
    installed = true;
  };
}

export const ensureGameInputDraftCloseGuard = createGameInputDraftCloseGuardInstaller(
  gameInputDrafts,
  registerAppCloseGuard,
);
