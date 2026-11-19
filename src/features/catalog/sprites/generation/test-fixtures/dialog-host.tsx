import { useState } from "react";

import type { SpriteCapabilities } from "../../../../../shared/types/sprite-capabilities";
import { SpriteGenerationDialog } from "../components/SpriteGenerationDialog";
import type { SpriteGenerationDialogProps } from "../hooks/use-sprite-generation";

/** What the recording's test character and connections look like. */
export const RECORDED_CHARACTER = {
  entityId: "<character-id>",
  defaultAvatarUrl: "<avatar-url:characters>",
  defaultAppearance: "QA look: short black hair, green coat",
};

export const RECORDED_PERSONA = {
  entityId: "<persona-id>",
  entityKind: "persona" as const,
  defaultAvatarUrl: "<avatar-url:personas>",
  defaultAppearance: "A test persona.",
};

export const RECORDED_CONNECTIONS = [
  { id: "<connection-gpt-image-1>", name: "QA image", model: "gpt-image-1" },
  { id: "<connection-gpt-image-2>", name: "QA image 2", model: "gpt-image-2" },
];

export const CAPABILITIES: SpriteCapabilities = {
  imageProcessingAvailable: true,
  spriteGenerationAvailable: true,
  backgroundRemovalAvailable: true,
  reason: null,
  cleanupEngine: { engine: "auto", installed: true, command: null, source: "builtin", runtimeDir: "", reason: null },
};

/** What the host saw the dialog do, and a way to open it again like the Sprites tab's button. */
export const hostEvents = {
  closes: 0,
  spritesGenerated: 0,
  setOpen: (_open: boolean) => {},
  reset() {
    this.closes = 0;
    this.spritesGenerated = 0;
  },
};

export type HostProps = Partial<Omit<SpriteGenerationDialogProps, "open" | "onClose" | "onSpritesGenerated">>;

/** Mounts the dialog the way the Sprites tabs do: kept mounted, `open` toggled. */
export function DialogHost(props: HostProps) {
  const [open, setOpen] = useState(true);
  hostEvents.setOpen = setOpen;
  return (
    <SpriteGenerationDialog
      open={open}
      onClose={() => {
        hostEvents.closes += 1;
        setOpen(false);
      }}
      onSpritesGenerated={() => {
        hostEvents.spritesGenerated += 1;
      }}
      initialSpriteType="expressions"
      existingExpressionNames={[]}
      imageConnections={RECORDED_CONNECTIONS}
      spriteCapabilities={CAPABILITIES}
      {...RECORDED_CHARACTER}
      {...props}
    />
  );
}
