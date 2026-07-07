const USER_ERROR_MESSAGES = {
  applyDekiAction: "Deki-senpai couldn't apply that action. Try again.",
  catalogRefreshAfterDekiAction:
    "The action was applied, but De-Koi couldn't refresh the catalog. Refresh the page before checking the result.",
  checkUpdates: "Couldn't check for updates. Check your connection and try again.",
  coreModuleLoad: "Couldn't load core module settings. Open De-Koi in the desktop app and try again.",
  coreModuleToggle: "Couldn't update that module. Try again.",
  createBackup: "Couldn't create a backup. Check available disk space and try again.",
  createDekiChat: "Deki-senpai couldn't start a new chat. Try again.",
  deleteBackup: "Couldn't delete that backup. Try again.",
  deleteChatFile: "Couldn't delete that chat file. Try again.",
  dekiHistoryLoad: "Deki-senpai couldn't load chat history. Try again.",
  dekiPreferencesLoad: "Deki-senpai couldn't load preferences. Try again.",
  dekiPreferencesSave: "Deki-senpai couldn't save preferences. Try again.",
  dekiRetry: "Deki-senpai couldn't retry that message. Your chat is unchanged. Try again.",
  dekiSend: "Deki-senpai couldn't send that. Your draft is still here. Try again.",
  downloadBackup: "Couldn't download that backup. Try again.",
  exportProfile: "Couldn't export that profile. Choose a location and try again.",
  featuredCardsSave:
    "Couldn't save featured cards. Your selection is still shown here, but it may not stick. Try again.",
  gameAssetCopy: "Couldn't copy that asset. Choose another folder or try again.",
  gameAssetLoad: "Couldn't load game assets. Try again.",
  gameStart: "Couldn't start the game. Your setup is still here. Try again.",
  importChat: "Couldn't import that chat file. Pick another file or try again.",
  importSettings: "Couldn't import that file. Pick a supported De-Koi export and try again.",
  loadSecretPlotMemory: "Couldn't load Secret Plot memory. Try again.",
  lorebookScan: "Couldn't scan lorebook entries. Try again.",
  openUpdate: "Couldn't open the update. Check your connection and try again.",
  refreshApp: "Couldn't refresh De-Koi. Save your work, then try again.",
  roleplayStateClear:
    "De-Koi couldn't save that reset. Your session may still have the old state. Try clearing it again.",
  sceneRetry: "Scene analysis couldn't be retried. Your scene is unchanged. Try again.",
  secretPlotReroll: "Secret Plot reroll failed. Your previous plot state is still saved. Try again.",
  speechRecognition: "Couldn't use the microphone. Check microphone permission and try again.",
  trackerRerun: "Tracker rerun failed. Your tracker state is unchanged. Try again.",
  translateDraft: "Couldn't translate this draft. Check the translation connection and try again.",
  translateMessage: "Couldn't translate this message. Check the translation connection and try again.",
  worldTick: "Couldn't update the world state. Your current scene is unchanged. Try again.",
} as const;

export type UserErrorContext = keyof typeof USER_ERROR_MESSAGES;

type UserMessageOptions = {
  fallback?: string;
};

export function toUserMessage(_error: unknown, context?: UserErrorContext | UserMessageOptions): string {
  if (typeof context === "string") return USER_ERROR_MESSAGES[context];
  return context?.fallback ?? "Something didn't work. Try again.";
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return toUserMessage(error, { fallback });
}
