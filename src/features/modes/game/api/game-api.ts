import * as assetsApi from "./game-api-assets";
import * as checkpointsApi from "./game-api-checkpoints";
import * as journalApi from "./game-api-journal";
import * as lorebookKeeperApi from "./game-api-lorebook-keeper";
import * as mapApi from "./game-api-map";
import * as mechanicsApi from "./game-api-mechanics";
import * as partyApi from "./game-api-party";
import * as sessionApi from "./game-api-session";
import * as spotifySceneApi from "./game-api-spotify";
import type { GameAssetGenerationPayload } from "./game-api-support";

export type {
  CreateGameResponse,
  GameAssetGenerationPayload,
  GameAssetGenerationResult,
  GameCheckpointWarning,
  GameImagePromptReviewItem,
  GameJournalResponse,
  MapResponse,
  PartyCardResponse,
  RegenerateSessionLorebookResponse,
  SessionSummaryResponse,
  SetupResponse,
  StartGameResponse,
  StartSessionResponse,
  UpdateCampaignProgressionResponse,
} from "./game-api-support";

export { applyGameJsonRepair } from "./game-api-repair";

export const gameApi = {
  createGame: sessionApi.createGame,
  setupGame: sessionApi.setupGame,
  startGame: sessionApi.startGame,
  startSession: sessionApi.startSession,
  concludeSession: sessionApi.concludeSession,
  regenerateSessionConclusion: sessionApi.regenerateSessionConclusion,
  regenerateSessionLorebook: lorebookKeeperApi.regenerateSessionLorebook,
  updateCampaignProgression: sessionApi.updateCampaignProgression,
  upsertPartyCard: partyApi.upsertPartyCard,
  removePartyMember: partyApi.removePartyMember,
  rollDice: mechanicsApi.rollDice,
  skillCheck: mechanicsApi.skillCheck,
  transitionGameState: mechanicsApi.transitionGameState,
  generateMap: mapApi.generateMap,
  moveOnMap: mapApi.moveOnMap,
  updateWidgets: mechanicsApi.updateWidgets,
  gameSessions: sessionApi.gameSessions,
  combatRound: mechanicsApi.combatRound,
  applyMoraleEvent: mechanicsApi.applyMoraleEvent,
  elementPresets: mechanicsApi.elementPresets,
  elementPreset: mechanicsApi.elementPreset,
  combatLoot: mechanicsApi.combatLoot,
  lootGenerate: mechanicsApi.lootGenerate,
  advanceTime: mechanicsApi.advanceTime,
  updateWeather: mechanicsApi.updateWeather,
  rollEncounter: mechanicsApi.rollEncounter,
  updateReputation: mechanicsApi.updateReputation,
  addJournalEntry: journalApi.addJournalEntry,
  getJournal: journalApi.getJournal,
  updateNotes: journalApi.updateNotes,
  listCheckpoints: checkpointsApi.listCheckpoints,
  createCheckpoint: checkpointsApi.createCheckpoint,
  loadCheckpoint: checkpointsApi.loadCheckpoint,
  branchFromCheckpoint: checkpointsApi.branchFromCheckpoint,
  deleteCheckpoint: checkpointsApi.deleteCheckpoint,
  partyTurn: partyApi.partyTurn,
  initCombatEncounter: mechanicsApi.initCombatEncounter,
  spotifyCandidates: spotifySceneApi.spotifyCandidates,
  spotifyPlay: spotifySceneApi.spotifyPlay,
  previewGeneratedAssets: assetsApi.previewGeneratedAssets,
  generateAssets: (payload: GameAssetGenerationPayload, signal?: AbortSignal) =>
    assetsApi.generateAssets(payload, signal),
};
