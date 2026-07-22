import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HelpHub } from "./HelpHub";

describe("HelpHub guided setup action", () => {
  it("offers the optional tour without implying setup completion", () => {
    const html = renderToStaticMarkup(<HelpHub />);

    expect(html).toContain("Show me around");
    expect(html).toContain("readiness checklist");
    expect(html).not.toContain("Replay onboarding");
  });
});
