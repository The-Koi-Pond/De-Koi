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

it("keeps a compact visual count out of an enclosing control's accessible name", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ContinuityDirectorReviewBadge count={1} compact decorative />));
  expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("1");
  expect(container.querySelector('[aria-label="1 story beat to review"]')).toBeNull();
  act(() => root.unmount());
});
