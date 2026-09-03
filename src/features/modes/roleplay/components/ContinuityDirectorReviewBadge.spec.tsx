import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { ContinuityDirectorReviewBadge } from "./ContinuityDirectorReviewBadge";

it("renders nothing for an empty review queue", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ContinuityDirectorReviewBadge count={0} compact />));
  expect(container.textContent).toBe("");
  act(() => root.unmount());
});

it("renders accessible compact and full review counts", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ContinuityDirectorReviewBadge count={3} compact />));
  expect(container.querySelector('[aria-label="3 story beats to review"]')?.textContent).toBe("3");
  act(() => root.render(<ContinuityDirectorReviewBadge count={3} />));
  expect(container.textContent).toContain("3 to review");
  act(() => root.unmount());
});
