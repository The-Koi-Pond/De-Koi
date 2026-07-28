import { describe, expect, it } from "vitest";

import { planPreviousImageCleanup } from "../../scripts/pi-image-cleanup.mjs";

const OLD_SERVER = "sha256:old-server";
const OLD_WEB = "sha256:old-web";
const NEW_SERVER = "sha256:new-server";
const NEW_WEB = "sha256:new-web";

describe("planPreviousImageCleanup", () => {
  it("selects only the captured previous untagged pair", () => {
    const result = planPreviousImageCleanup({
      previousImageIds: [OLD_SERVER, OLD_WEB],
      currentImageIds: [NEW_SERVER, NEW_WEB],
      targetImageIds: [NEW_SERVER, NEW_WEB],
      imageTagsById: new Map([
        [OLD_SERVER, []],
        [OLD_WEB, []],
        ["sha256:unrelated-dangling", []],
      ]),
    });

    expect(result).toEqual({
      ok: true,
      removableImageIds: [OLD_SERVER, OLD_WEB],
      retainedImages: [],
    });
  });

  it("blocks cleanup unless the running pair matches the pulled target pair", () => {
    const result = planPreviousImageCleanup({
      previousImageIds: [OLD_SERVER, OLD_WEB],
      currentImageIds: [NEW_SERVER, OLD_WEB],
      targetImageIds: [NEW_SERVER, NEW_WEB],
      imageTagsById: new Map([
        [OLD_SERVER, []],
        [OLD_WEB, []],
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("running Pi containers do not match");
    expect(result).not.toHaveProperty("removableImageIds");
  });

  it("retains captured images that are still tagged or still running", () => {
    const result = planPreviousImageCleanup({
      previousImageIds: [OLD_SERVER, NEW_WEB],
      currentImageIds: [NEW_SERVER, NEW_WEB],
      targetImageIds: [NEW_SERVER, NEW_WEB],
      imageTagsById: new Map([
        [OLD_SERVER, ["ghcr.io/the-koi-pond/de-koi-server:rollback"]],
        [NEW_WEB, []],
      ]),
    });

    expect(result).toEqual({
      ok: true,
      removableImageIds: [],
      retainedImages: [
        { imageId: OLD_SERVER, reason: "still-tagged" },
        { imageId: NEW_WEB, reason: "still-running" },
      ],
    });
  });

  it("treats an already removed captured image as a safe no-op", () => {
    const result = planPreviousImageCleanup({
      previousImageIds: [OLD_SERVER],
      currentImageIds: [NEW_SERVER, NEW_WEB],
      targetImageIds: [NEW_SERVER, NEW_WEB],
      imageTagsById: new Map(),
    });

    expect(result).toEqual({
      ok: true,
      removableImageIds: [],
      retainedImages: [{ imageId: OLD_SERVER, reason: "already-removed" }],
    });
  });
});
