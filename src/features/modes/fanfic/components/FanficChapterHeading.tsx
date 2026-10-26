import { useMemo } from "react";
import { fanficModelLabel, readFanficVersion } from "../../../../engine/modes/fanfic/versions";
import { FanficChip } from "./fanfic-ui";

/**
 * A chapter's heading, with the models that wrote the version on screen (older chapters show none) and, for an extra
 * no later chapter builds on, a side-story mark.
 */
export function FanficChapterHeading({
  id,
  heading,
  extra,
  sideStory = false,
}: {
  id: string;
  heading: string;
  extra: unknown;
  sideStory?: boolean;
}) {
  const label = useMemo(() => fanficModelLabel(readFanficVersion(extra)?.models ?? []), [extra]);
  return (
    <div>
      <h3 id={id} className="text-lg font-bold text-[var(--foreground)]">
        {heading}
      </h3>
      {sideStory && (
        <div className="mt-1">
          <FanficChip>Side story</FanficChip>
        </div>
      )}
      {label && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Written by {label}</p>}
    </div>
  );
}
