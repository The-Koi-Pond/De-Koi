import { useMemo } from "react";
import { fanficModelLabel, readFanficVersion } from "../../../../engine/modes/fanfic/versions";

/** A chapter's heading, with the models that wrote the version on screen; older chapters show no models. */
export function FanficChapterHeading({ id, heading, extra }: { id: string; heading: string; extra: unknown }) {
  const label = useMemo(() => fanficModelLabel(readFanficVersion(extra)?.models ?? []), [extra]);
  return (
    <div>
      <h3 id={id} className="text-lg font-bold text-[var(--foreground)]">
        {heading}
      </h3>
      {label && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Written by {label}</p>}
    </div>
  );
}
