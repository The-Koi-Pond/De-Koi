#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_IMAGES = ["ghcr.io/the-koi-pond/de-koi-server:prealpha", "ghcr.io/the-koi-pond/de-koi-web:prealpha"];
const DEFAULT_CONTAINERS = ["de-koi-server", "de-koi-web"];

function normalizeImageId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeImageIds(values) {
  return [...new Set(values.map(normalizeImageId).filter(Boolean))];
}

export function planPreviousImageCleanup({ previousImageIds, currentImageIds, targetImageIds, imageTagsById }) {
  const previous = normalizeImageIds(previousImageIds);
  const current = currentImageIds.map(normalizeImageId);
  const target = targetImageIds.map(normalizeImageId);

  if (
    current.length === 0 ||
    current.length !== target.length ||
    current.some((imageId, index) => !imageId || imageId !== target[index])
  ) {
    return {
      ok: false,
      error: `Refusing previous Pi image cleanup because running Pi containers do not match the pulled target pair: running=${current.join(
        ",",
      )}; target=${target.join(",")}.`,
    };
  }

  const currentSet = new Set(current);
  const removableImageIds = [];
  const retainedImages = [];
  for (const imageId of previous) {
    if (currentSet.has(imageId)) {
      retainedImages.push({ imageId, reason: "still-running" });
      continue;
    }
    if (!imageTagsById.has(imageId)) {
      retainedImages.push({ imageId, reason: "already-removed" });
      continue;
    }
    const tags = imageTagsById.get(imageId) ?? [];
    if (tags.length > 0) {
      retainedImages.push({ imageId, reason: "still-tagged" });
      continue;
    }
    removableImageIds.push(imageId);
  }

  return {
    ok: true,
    removableImageIds,
    retainedImages,
  };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function safeRunResult(command, args) {
  try {
    return { ok: true, output: run(command, args) };
  } catch (error) {
    return {
      ok: false,
      error: String(error.stderr ?? error.message ?? `${command} failed`).trim(),
    };
  }
}

function isMissingDockerObject(error) {
  return /No such (object|container|image)|No such container/i.test(error);
}

function parseCsv(value, fallback) {
  const parsed = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function inspectContainerImageId(container, { allowMissing }) {
  const result = safeRunResult("docker", ["container", "inspect", container, "--format", "{{.Image}}"]);
  if (result.ok) {
    return normalizeImageId(result.output);
  }
  if (allowMissing && isMissingDockerObject(result.error)) {
    return "";
  }
  throw new Error(`Could not inspect Pi container ${container}: ${result.error || "docker inspect failed"}`);
}

function inspectImageId(image) {
  const result = safeRunResult("docker", ["image", "inspect", image, "--format", "{{.Id}}"]);
  if (!result.ok) {
    throw new Error(`Could not inspect pulled Pi image ${image}: ${result.error || "docker inspect failed"}`);
  }
  return normalizeImageId(result.output);
}

function inspectImageTags(imageId) {
  const result = safeRunResult("docker", ["image", "inspect", imageId, "--format", "{{json .RepoTags}}"]);
  if (!result.ok) {
    if (isMissingDockerObject(result.error)) {
      return null;
    }
    throw new Error(`Could not inspect previous Pi image ${imageId}: ${result.error || "docker inspect failed"}`);
  }
  const parsed = JSON.parse(result.output || "null");
  if (parsed == null) {
    return [];
  }
  if (!Array.isArray(parsed) || !parsed.every((tag) => typeof tag === "string")) {
    throw new Error(`Previous Pi image ${imageId} returned invalid RepoTags metadata.`);
  }
  return parsed.filter(Boolean);
}

function configuredContainers() {
  return parseCsv(process.env.DE_KOI_PI_CONTAINERS, DEFAULT_CONTAINERS);
}

function configuredImages() {
  return parseCsv(process.env.DE_KOI_PI_IMAGES, DEFAULT_IMAGES);
}

function capturePreviousImageIds() {
  return normalizeImageIds(
    configuredContainers().map((container) => inspectContainerImageId(container, { allowMissing: true })),
  );
}

function parsePreviousImageIds(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value ?? ""));
  } catch {
    throw new Error("Previous Pi image capture is not valid JSON.");
  }
  if (!Array.isArray(parsed) || !parsed.every((imageId) => typeof imageId === "string")) {
    throw new Error("Previous Pi image capture must be a JSON array of image IDs.");
  }
  return normalizeImageIds(parsed);
}

function cleanupPreviousImages(previousImageIds) {
  const containers = configuredContainers();
  const images = configuredImages();
  if (containers.length !== images.length) {
    throw new Error(
      `Refusing previous Pi image cleanup because ${containers.length} containers do not map to ${images.length} image references.`,
    );
  }

  const currentImageIds = containers.map((container) => inspectContainerImageId(container, { allowMissing: false }));
  const targetImageIds = images.map((image) => inspectImageId(image));
  const imageTagsById = new Map();
  for (const imageId of previousImageIds) {
    const tags = inspectImageTags(imageId);
    if (tags !== null) {
      imageTagsById.set(imageId, tags);
    }
  }

  const plan = planPreviousImageCleanup({
    previousImageIds,
    currentImageIds,
    targetImageIds,
    imageTagsById,
  });
  if (!plan.ok) {
    throw new Error(plan.error);
  }

  for (const imageId of plan.removableImageIds) {
    const output = run("docker", ["image", "rm", imageId]);
    if (output) {
      console.log(output);
    }
  }
  if (plan.removableImageIds.length > 0) {
    console.log(`Removed ${plan.removableImageIds.length} exact previous untagged Pi image(s).`);
  } else {
    console.log("No captured previous untagged Pi images were safe to remove.");
  }
  for (const retained of plan.retainedImages) {
    console.log(`Retained previous Pi image ${retained.imageId}: ${retained.reason}.`);
  }
}

function main() {
  const mode = process.argv[2];
  if (mode === "capture") {
    console.log(JSON.stringify(capturePreviousImageIds()));
    return;
  }
  if (mode === "cleanup") {
    cleanupPreviousImages(parsePreviousImageIds(process.argv[3]));
    return;
  }
  throw new Error("Usage: node scripts/pi-image-cleanup.mjs <capture|cleanup> [previous-image-ids-json]");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
