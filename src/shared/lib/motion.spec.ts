import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { motionStyle } from "./motion";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../styles/globals/05-effects-utilities.css"),
  "utf8",
);

function block(selector: string) {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("motionStyle", () => {
  it("sets enter start values and exit end values separately", () => {
    expect(motionStyle({ enterFrom: { y: 12, scale: 0.96 }, exitTo: { y: -8 }, exitDurationMs: 250 })).toEqual({
      "--motion-ease": "cubic-bezier(0.16, 1, 0.3, 1)",
      "--motion-from-y": "12px",
      "--motion-from-scale": "0.96",
      "--motion-to-y": "-8px",
      "--motion-exit-duration": "250ms",
    });
  });

  it("settles entering elements on their own resting styles", () => {
    // The enter keyframes define only a start frame, and backwards fill drops
    // the animation once it ends, so an element rests at scale 1 with no offset
    // whatever its exit values are.
    for (const keyframes of ["@keyframes motion-enter", "@keyframes motion-enter-blur"]) {
      expect(block(keyframes)).toContain("from {");
      expect(block(keyframes)).not.toMatch(/\bto \{|100%/);
    }
    expect(block(".motion-enter")).toContain("backwards");
    expect(block(".motion-exit")).toContain("forwards");
  });

  it("renders entering elements at rest when the user asks for reduced motion", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.motion-enter,\s*\.motion-enter-blur \{\s*animation: none;/,
    );
  });
});
