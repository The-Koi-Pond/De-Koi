import type {
  CharacterStat,
  CustomTrackerField,
  TrackerState,
  InventoryItem,
  PlayerStats,
  PresentCharacter,
  QuestProgress,
} from "../../../engine/contracts/types/tracker-state";
import type { TemperatureUnit } from "../../../shared/lib/temperature-units";

export type TrackerStatePatchField =
  | "date"
  | "time"
  | "location"
  | "weather"
  | "temperature"
  | "presentCharacters"
  | "playerStats"
  | "personaStats";

export type WorldStatePatchField = Extract<
  TrackerStatePatchField,
  "date" | "time" | "location" | "weather" | "temperature"
>;

export type WorldTemperatureUnit = TemperatureUnit;

export interface TrackerStatePatchValue {
  date: TrackerState["date"];
  time: TrackerState["time"];
  location: TrackerState["location"];
  weather: TrackerState["weather"];
  temperature: TrackerState["temperature"];
  presentCharacters: TrackerState["presentCharacters"];
  playerStats: TrackerState["playerStats"];
  personaStats: TrackerState["personaStats"];
}

export interface TrackerStateSnapshot {
  gameState: TrackerState | null;
  playerStats: PlayerStats | null;
  personaStats: CharacterStat[];
  presentCharacters: PresentCharacter[];
  inventory: InventoryItem[];
  quests: QuestProgress[];
  customTrackerFields: CustomTrackerField[];
}

export interface TrackerStateController extends TrackerStateSnapshot {
  loadingTrackerState: boolean;
  gameStateRefreshing: boolean;
  isLoadingTrackerState: boolean;
  getSnapshot: () => TrackerStateSnapshot;
  patchField: <K extends TrackerStatePatchField>(field: K, value: TrackerStatePatchValue[K]) => void;
  patchPlayerStats: <K extends keyof PlayerStats>(field: K, value: PlayerStats[K]) => void;
  flushPatch: () => Promise<void>;
}
