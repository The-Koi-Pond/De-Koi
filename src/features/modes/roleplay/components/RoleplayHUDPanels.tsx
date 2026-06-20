import { Swords, X } from "lucide-react";
import type {
  CharacterStat,
  CustomTrackerField,
  InventoryItem,
  PresentCharacter,
  QuestProgress,
} from "../../../../engine/contracts/types/game-state";
import { CharactersTrackerSection } from "./RoleplayHUDCharactersTrackerSection";
import { CustomTrackerSection } from "./RoleplayHUDCustomTrackerSection";
import { InventoryTrackerSection } from "./RoleplayHUDInventoryTrackerSection";
import { PersonaTrackerSection } from "./RoleplayHUDPersonaTrackerSection";
import { QuestsTrackerSection } from "./RoleplayHUDQuestsTrackerSection";

type RetryControls = {
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
};

interface CombinedPlayerPanelProps extends RetryControls {
  showPersona: boolean;
  showCharacters: boolean;
  showInventory: boolean;
  showQuests: boolean;
  showCustomTracker: boolean;
  personaStats: CharacterStat[];
  onUpdatePersonaStats: (bars: CharacterStat[]) => void;
  personaStatus?: string;
  onUpdatePersonaStatus?: (status: string) => void;
  characters: PresentCharacter[];
  onUpdateCharacters: (chars: PresentCharacter[]) => void;
  inventory: InventoryItem[];
  onUpdateInventory: (items: InventoryItem[]) => void;
  quests: QuestProgress[];
  onUpdateQuests: (quests: QuestProgress[]) => void;
  customTrackerFields: CustomTrackerField[];
  onUpdateCustomTracker: (fields: CustomTrackerField[]) => void;
  onClose: () => void;
}

export function CombinedPlayerPanel({
  showPersona,
  showCharacters,
  showInventory,
  showQuests,
  showCustomTracker,
  personaStats,
  onUpdatePersonaStats,
  personaStatus = "",
  onUpdatePersonaStatus,
  characters,
  onUpdateCharacters,
  inventory,
  onUpdateInventory,
  quests,
  onUpdateQuests,
  customTrackerFields,
  onUpdateCustomTracker,
  onClose,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: CombinedPlayerPanelProps) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1">
          <Swords size="0.625rem" /> Trackers
        </span>
        <button
          onClick={onClose}
          className="text-[var(--muted-foreground)]/50 hover:text-[var(--foreground)] transition-colors"
        >
          <X size="0.75rem" />
        </button>
      </div>
      <div className="overflow-y-auto max-h-[min(calc(75vh-2rem),30rem)] divide-y divide-[var(--border)]">
        {showPersona && (
          <PersonaTrackerSection
            layout="combined"
            stats={personaStats}
            onUpdate={onUpdatePersonaStats}
            status={personaStatus}
            onUpdateStatus={onUpdatePersonaStatus}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        )}

        {showCharacters && (
          <CharactersTrackerSection
            layout="combined"
            characters={characters}
            onUpdate={onUpdateCharacters}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        )}

        {showInventory && <InventoryTrackerSection layout="combined" items={inventory} onUpdate={onUpdateInventory} />}

        {showQuests && (
          <QuestsTrackerSection
            layout="combined"
            quests={quests}
            onUpdate={onUpdateQuests}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        )}

        {showCustomTracker && (
          <CustomTrackerSection
            layout="combined"
            fields={customTrackerFields}
            onUpdate={onUpdateCustomTracker}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        )}
      </div>
    </>
  );
}

interface PersonaStatsPanelProps extends RetryControls {
  bars: CharacterStat[];
  onUpdate: (bars: CharacterStat[]) => void;
  status?: string;
  onUpdateStatus?: (status: string) => void;
}

export function PersonaStatsPanel({
  bars,
  onUpdate,
  status = "",
  onUpdateStatus,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: PersonaStatsPanelProps) {
  return (
    <PersonaTrackerSection
      stats={bars}
      onUpdate={onUpdate}
      status={status}
      onUpdateStatus={onUpdateStatus}
      onRerunSingleTracker={onRerunSingleTracker}
      isTrackerRetryBusy={isTrackerRetryBusy}
    />
  );
}

interface CharactersPanelProps extends RetryControls {
  characters: PresentCharacter[];
  onUpdate: (chars: PresentCharacter[]) => void;
  chatId?: string;
}

export function CharactersPanel({
  characters,
  onUpdate,
  chatId,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: CharactersPanelProps) {
  return (
    <CharactersTrackerSection
      characters={characters}
      onUpdate={onUpdate}
      chatId={chatId}
      onRerunSingleTracker={onRerunSingleTracker}
      isTrackerRetryBusy={isTrackerRetryBusy}
    />
  );
}

interface InventoryPanelProps {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void;
}

export function InventoryPanel({ items, onUpdate }: InventoryPanelProps) {
  return <InventoryTrackerSection items={items} onUpdate={onUpdate} />;
}

interface QuestsPanelProps extends RetryControls {
  quests: QuestProgress[];
  onUpdate: (quests: QuestProgress[]) => void;
}

export function QuestsPanel({ quests, onUpdate, onRerunSingleTracker, isTrackerRetryBusy }: QuestsPanelProps) {
  return (
    <QuestsTrackerSection
      quests={quests}
      onUpdate={onUpdate}
      onRerunSingleTracker={onRerunSingleTracker}
      isTrackerRetryBusy={isTrackerRetryBusy}
    />
  );
}

interface CustomTrackerPanelProps extends RetryControls {
  fields: CustomTrackerField[];
  onUpdate: (fields: CustomTrackerField[]) => void;
}

export function CustomTrackerPanel({
  fields,
  onUpdate,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: CustomTrackerPanelProps) {
  return (
    <CustomTrackerSection
      fields={fields}
      onUpdate={onUpdate}
      onRerunSingleTracker={onRerunSingleTracker}
      isTrackerRetryBusy={isTrackerRetryBusy}
    />
  );
}
