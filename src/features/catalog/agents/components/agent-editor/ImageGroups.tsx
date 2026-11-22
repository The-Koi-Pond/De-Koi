import { Image as ImageIcon, Sparkles } from "lucide-react";
import { useId } from "react";
import { cn } from "../../../../../shared/lib/utils";
import type { IllustratorAvatarReferenceMode } from "../../../../../engine/generation/illustrator-settings";
import { FIELD, FIELD_LABEL, FieldGroup, NOTE, SettingToggle, SMALL_LABEL } from "./editor-parts";

/** The Illustrator tag boxes: a 1px border (not a ring) that turns primary on focus. */
const TAG_BOX =
  "min-h-20 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2.5 text-xs placeholder:text-[var(--muted-foreground)]/45 focus:border-[var(--primary)] focus:outline-none";
import type { AgentEditorModel, ConnectionOption } from "./use-agent-editor";

function ImageConnectionOptions({ first, connections }: { first: string; connections: ConnectionOption[] }) {
  return (
    <>
      <option value="">{first}</option>
      {connections.map((connection) => (
        <option key={connection.id} value={connection.id}>
          {connection.name} ({connection.provider})
        </option>
      ))}
    </>
  );
}

const REFERENCE_MODES: ReadonlyArray<[IllustratorAvatarReferenceMode, string]> = [
  ["inherit", "Inherit chat setting"],
  ["enabled", "Always send"],
  ["disabled", "Never send"],
];

/** Illustrator: its image connection, image tags and reference images. */
export function IllustratorImageGroup({ editor }: { editor: AgentEditorModel }) {
  const connectionId = useId();
  const positiveId = useId();
  const negativeId = useId();
  const referencesId = useId();
  const { form, edit } = editor;
  const fallback = editor.imageDefaultConnection;
  return (
    <FieldGroup
      icon={ImageIcon}
      label="Image Generation Connection Override"
      htmlFor={connectionId}
      help="The connection used to generate images. This should point to an image generation API (e.g. DALL-E, NovelAI, Stable Diffusion). The Connection Override above is used for the LLM that decides when and what to illustrate. Leave this empty to use the default Illustrator image connection from Settings → Connections."
    >
      <select
        id={connectionId}
        value={form.imageConnectionId}
        onChange={(event) => edit({ imageConnectionId: event.target.value })}
        className={FIELD}
      >
        <ImageConnectionOptions
          first={fallback ? `Illustrator agent default (${fallback.name})` : "None (no image generation)"}
          connections={editor.imageConnections}
        />
      </select>
      <p className={cn(NOTE, "mt-1")}>
        The Illustrator uses two connections: the LLM above analyzes the scene and writes an image prompt, then this
        connection generates the actual image from that prompt. Leave this empty to use the default Illustrator image
        connection from Settings → Connections, if one is configured.
      </p>
      <div className="grid grid-cols-1 gap-3 pt-1 md:grid-cols-2">
        <div>
          <label htmlFor={positiveId} className={SMALL_LABEL}>
            Positive prompt / tags
          </label>
          <textarea
            id={positiveId}
            value={form.imagePositivePrompt}
            onChange={(event) => edit({ imagePositivePrompt: event.target.value })}
            placeholder="masterpiece, best quality, detailed lighting"
            className={TAG_BOX}
          />
        </div>
        <div>
          <label htmlFor={negativeId} className={SMALL_LABEL}>
            Negative prompt
          </label>
          <textarea
            id={negativeId}
            value={form.imageNegativePrompt}
            onChange={(event) => edit({ imageNegativePrompt: event.target.value })}
            placeholder="lowres, bad anatomy, text artifacts"
            className={TAG_BOX}
          />
        </div>
      </div>
      <p className={cn(NOTE, "mt-1")}>
        Saved on the Illustrator agent. Positive tags are appended after the generated prompt; negative tags are sent
        directly to the image generator and combine with any connection-level defaults. NovelAI tag syntax is supported.
      </p>
      <div className="pt-1">
        <label htmlFor={referencesId} className={SMALL_LABEL}>
          Character &amp; persona references
        </label>
        <select
          id={referencesId}
          value={form.avatarReferenceMode}
          onChange={(event) => edit({ avatarReferenceMode: event.target.value as IllustratorAvatarReferenceMode })}
          className={FIELD}
        >
          {REFERENCE_MODES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <p className={cn(NOTE, "mt-1")}>
        Sends full-body sprites when available, otherwise character avatars and your persona avatar, to the image
        generator for visual reference. Works best with providers that support reference images (NovelAI, Stability,
        A1111, ComfyUI).
      </p>
    </FieldGroup>
  );
}

/** Character Tracker: NPC portraits, on the same image connection value. */
export function NpcAvatarsGroup({ editor }: { editor: AgentEditorModel }) {
  const connectionId = useId();
  const { form, edit } = editor;
  return (
    <FieldGroup
      icon={Sparkles}
      label="Auto-Generate NPC Avatars"
      help="When enabled, the Character Tracker will automatically generate portrait images for NPCs that don't have an avatar, using their appearance description."
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--foreground)]">
        <input
          type="checkbox"
          checked={form.autoGenerateAvatars}
          onChange={(event) => edit({ autoGenerateAvatars: event.target.checked })}
        />
        Generate avatar portraits for new NPCs
      </label>
      {form.autoGenerateAvatars && (
        <div>
          <label htmlFor={connectionId} className={FIELD_LABEL}>
            Image Generation Connection
          </label>
          <select
            id={connectionId}
            value={form.imageConnectionId}
            onChange={(event) => edit({ imageConnectionId: event.target.value })}
            className={FIELD}
          >
            <ImageConnectionOptions first="None (select a connection)" connections={editor.imageConnections} />
          </select>
        </div>
      )}
    </FieldGroup>
  );
}

/** Background: generate a background when the chat has none. */
export function BackgroundImageGroup({ editor }: { editor: AgentEditorModel }) {
  const connectionId = useId();
  const { form, edit } = editor;
  const fallback = editor.imageDefaultConnection;
  const on = form.autoGenerateBackgrounds;
  return (
    <FieldGroup
      icon={ImageIcon}
      label="Background Image Generation"
      help="When enabled, the Background agent can generate one reusable roleplay background when the chat does not already have one. It never auto-selects library images."
    >
      <SettingToggle
        wide
        on={on}
        title={on ? "Generate when missing" : "Leave backgrounds unchanged"}
        description={
          on
            ? "If the chat has no background, the agent can request a suitable generated scene."
            : "Backgrounds only change when you choose one manually."
        }
        onToggle={() => edit((current) => ({ autoGenerateBackgrounds: !current.autoGenerateBackgrounds }))}
      />
      {on && (
        <>
          <div>
            <label htmlFor={connectionId} className={FIELD_LABEL}>
              Image Generation Connection
            </label>
            <select
              id={connectionId}
              value={form.imageConnectionId}
              onChange={(event) => edit({ imageConnectionId: event.target.value })}
              className={FIELD}
            >
              <ImageConnectionOptions
                first={fallback ? `Agent image default (${fallback.name})` : "None (select a connection)"}
                connections={editor.imageConnections}
              />
            </select>
          </div>
          <p className={NOTE}>
            Generated images are saved into your normal Backgrounds library, so later runs can reuse them instead of
            regenerating the same place.
          </p>
          {!form.imageConnectionId && !fallback && (
            <p className="text-[0.625rem] text-amber-400">
              Add an image generation connection here or mark one as the default for agents in Connections.
            </p>
          )}
        </>
      )}
    </FieldGroup>
  );
}
