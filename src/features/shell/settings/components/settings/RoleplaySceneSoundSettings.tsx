import { useTTSConfig } from "../../../../../shared/hooks/use-tts";
import { sceneSoundUnavailableReason } from "../../../../../shared/lib/sound-effects";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { ToggleSetting } from "./SettingControls";

function VolumeSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2 pl-6">
      <span className="w-24 shrink-0 text-[0.6875rem] text-[var(--foreground)]">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 accent-[var(--primary)] disabled:opacity-50"
      />
      <span className="w-10 text-right text-xs tabular-nums text-[var(--muted-foreground)]">
        {Math.round(value * 100)}%
      </span>
    </label>
  );
}

/** Roleplay scene sound: the switch, its cost, and separate ambient and effect volumes. Saved on this device. */
export function RoleplaySceneSoundSettings() {
  const enabled = useUIStore((state) => state.roleplaySceneSound);
  const setEnabled = useUIStore((state) => state.setRoleplaySceneSound);
  const ambientVolume = useUIStore((state) => state.sceneAmbientVolume);
  const setAmbientVolume = useUIStore((state) => state.setSceneAmbientVolume);
  const effectsVolume = useUIStore((state) => state.sceneEffectsVolume);
  const setEffectsVolume = useUIStore((state) => state.setSceneEffectsVolume);
  const { data: ttsConfig } = useTTSConfig();
  const unavailable = ttsConfig ? sceneSoundUnavailableReason(ttsConfig) : null;

  return (
    <div id="settings-destination-scene-sound" className="flex flex-col gap-1.5">
      <ToggleSetting label="Scene sound (ambience and sound effects)" checked={enabled} onChange={setEnabled} />
      <p className="pl-6 text-[0.625rem] text-[var(--muted-foreground)]">
        Plays a background loop that fits the scene (rain, a tavern, the sea…) and at most one sound per reply for clear
        events like a door slamming or thunder. The scene is read from World State, or from the scene text when a chat
        has none; no extra model call. Sounds are made by ElevenLabs the first time they're needed, then kept on this
        device and replay free: about 800 credits per background loop and 200 per effect, roughly 11,000 credits if
        every sound gets used, plus 200 for each new sound a reply writes itself as [SFX: …]. The API key needs the
        Sound Effects permission.
      </p>
      {unavailable && <p className="pl-6 text-[0.625rem] font-medium text-amber-500">{unavailable}</p>}
      <VolumeSlider label="Ambience volume" value={ambientVolume} onChange={setAmbientVolume} disabled={!enabled} />
      <VolumeSlider label="Effects volume" value={effectsVolume} onChange={setEffectsVolume} disabled={!enabled} />
    </div>
  );
}
