import { describe, expect, it } from "vitest";

import { checkImageRevisions, deployedRevisionFromContainerRevisions } from "../../scripts/pi-image-guard.mjs";

const SERVER_IMAGE = "ghcr.io/the-koi-pond/de-koi-server:prealpha";
const WEB_IMAGE = "ghcr.io/the-koi-pond/de-koi-web:prealpha";
const CURRENT_REVISION = "1111111111111111111111111111111111111111";
const NEXT_REVISION = "2222222222222222222222222222222222222222";
const OLD_REVISION = "0000000000000000000000000000000000000000";

function ancestry(older: string, newer: string) {
  return (
    (older === CURRENT_REVISION && newer === NEXT_REVISION) ||
    (older === OLD_REVISION && newer === CURRENT_REVISION) ||
    (older === OLD_REVISION && newer === NEXT_REVISION)
  );
}

describe("checkImageRevisions", () => {
  it("accepts a matching server and web image batch newer than the deployed batch", () => {
    const result = checkImageRevisions({
      currentRevision: CURRENT_REVISION,
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(true);
    expect(result.revision).toBe(NEXT_REVISION);
  });

  it("accepts the first image migration when no deployed image revision is detectable", () => {
    const result = checkImageRevisions({
      currentRevision: "",
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(true);
    expect(result.revision).toBe(NEXT_REVISION);
  });

  it("rejects mismatched server and web image batches", () => {
    const result = checkImageRevisions({
      currentRevision: CURRENT_REVISION,
      images: [
        { image: SERVER_IMAGE, revision: OLD_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("same cooked batch");
    expect(result.message).toContain("de-koi-server");
    expect(result.message).toContain("de-koi-web");
  });

  it("rejects images that do not expose a source revision label", () => {
    const result = checkImageRevisions({
      currentRevision: CURRENT_REVISION,
      images: [{ image: SERVER_IMAGE, revision: "" }],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("missing org.opencontainers.image.revision");
  });

  it("allows a pre-pull check when no cached images exist yet", () => {
    const result = checkImageRevisions({
      allowMissingImages: true,
      currentRevision: "",
      images: [
        { image: SERVER_IMAGE, revision: "" },
        { image: WEB_IMAGE, revision: "" },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("No cached Pi image batch");
  });

  it("rejects a partial cached image batch before pull", () => {
    const result = checkImageRevisions({
      allowMissingImages: true,
      currentRevision: CURRENT_REVISION,
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: "" },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("missing org.opencontainers.image.revision");
  });

  it("rejects downgrades when the current deployed batch is newer", () => {
    const result = checkImageRevisions({
      currentRevision: CURRENT_REVISION,
      images: [
        { image: SERVER_IMAGE, revision: OLD_REVISION },
        { image: WEB_IMAGE, revision: OLD_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Refusing to deploy older Pi images");
    expect(result.message).toContain(CURRENT_REVISION);
    expect(result.message).toContain(OLD_REVISION);
  });

  it("reports unresolved Git history separately from proven downgrades", () => {
    const result = checkImageRevisions({
      currentRevision: CURRENT_REVISION,
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: () => undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Git history proof failed");
    expect(result.message).toContain("unresolved_ancestry");
    expect(result.message).toContain(CURRENT_REVISION);
    expect(result.message).toContain(NEXT_REVISION);
  });

  it("blocks when deployed container revisions disagree", () => {
    const current = deployedRevisionFromContainerRevisions([
      { container: "de-koi-server", revision: CURRENT_REVISION },
      { container: "de-koi-web", revision: OLD_REVISION },
    ]);

    const result = checkImageRevisions({
      currentRevision: current.revision,
      currentRevisionError: current.error,
      currentRevisionState: current.state,
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(current.state).toBe("blocked");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("currently deployed Pi containers are not the same cooked batch");
    expect(result.message).toContain("de-koi-server");
    expect(result.message).toContain("de-koi-web");
  });

  it("blocks current-state handoffs that only preserve the blocked state", () => {
    const result = checkImageRevisions({
      currentRevision: "",
      currentRevisionState: "blocked",
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("current Pi deployment state is blocked");
  });

  it("blocks when deployed container inspection fails", () => {
    const current = deployedRevisionFromContainerRevisions([
      { container: "de-koi-server", revision: CURRENT_REVISION },
      { container: "de-koi-web", revision: "", error: "docker daemon unavailable" },
    ]);

    const result = checkImageRevisions({
      currentRevision: current.revision,
      currentRevisionError: current.error,
      currentRevisionState: current.state,
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(current.state).toBe("blocked");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("could not be inspected");
  });

  it("treats a readable empty deployment as first migration", () => {
    const current = deployedRevisionFromContainerRevisions([
      { container: "de-koi-server", revision: "" },
      { container: "de-koi-web", revision: "" },
    ]);

    const result = checkImageRevisions({
      currentRevision: current.revision,
      currentRevisionState: current.state,
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(current.state).toBe("empty");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("no deployed image batch was detected");
  });

  it("reports mixed deployed containers before candidate image problems", () => {
    const current = deployedRevisionFromContainerRevisions([
      { container: "de-koi-server", revision: CURRENT_REVISION },
      { container: "de-koi-web", revision: OLD_REVISION },
    ]);

    const result = checkImageRevisions({
      currentRevision: current.revision,
      currentRevisionError: current.error,
      currentRevisionState: current.state,
      images: [
        { image: SERVER_IMAGE, revision: OLD_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("currently deployed Pi containers are not the same cooked batch");
  });

  it("does not let the emergency override bypass mixed deployed containers", () => {
    const current = deployedRevisionFromContainerRevisions([
      { container: "de-koi-server", revision: CURRENT_REVISION },
      { container: "de-koi-web", revision: OLD_REVISION },
    ]);

    const result = checkImageRevisions({
      allowRevision: NEXT_REVISION,
      currentRevision: current.revision,
      currentRevisionError: current.error,
      currentRevisionState: current.state,
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("currently deployed Pi containers are not the same cooked batch");
  });

  it("reports fetch failures as a distinct ancestry prerequisite", () => {
    const result = checkImageRevisions({
      currentRevision: CURRENT_REVISION,
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: () => ({ ok: false, code: "fetch_failed", reason: "failed to fetch revision" }),
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed to fetch revision");
    expect(result.message).toContain("fetch_failed");
    expect(result.message).toContain("Git history proof failed");
  });

  it("reports deepen failures as a distinct ancestry prerequisite", () => {
    const result = checkImageRevisions({
      currentRevision: CURRENT_REVISION,
      images: [
        { image: SERVER_IMAGE, revision: NEXT_REVISION },
        { image: WEB_IMAGE, revision: NEXT_REVISION },
      ],
      isAncestor: () => ({ ok: false, code: "deepen_failed", reason: "failed to deepen main history" }),
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("deepen_failed");
    expect(result.message).toContain("failed to deepen main history");
  });

  it("allows an explicit emergency revision override", () => {
    const result = checkImageRevisions({
      allowRevision: OLD_REVISION,
      currentRevision: CURRENT_REVISION,
      images: [
        { image: SERVER_IMAGE, revision: OLD_REVISION },
        { image: WEB_IMAGE, revision: OLD_REVISION },
      ],
      isAncestor: ancestry,
    });

    expect(result.ok).toBe(true);
    expect(result.revision).toBe(OLD_REVISION);
    expect(result.message).toContain("override");
  });
});
