#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_IMAGES = [
  "ghcr.io/the-koi-pond/de-koi-server:prealpha",
  "ghcr.io/the-koi-pond/de-koi-web:prealpha",
];
const DEFAULT_CONTAINERS = ["de-koi-server", "de-koi-web"];

function normalizeRevision(value) {
  return String(value ?? "").trim().toLowerCase();
}

function ancestryFailureDetails(value) {
  if (value && typeof value === "object" && value.ok === false) {
    return {
      code: String(value.code ?? "unknown_ancestry_failure").trim(),
      reason: String(value.reason ?? "Git ancestry check failed").trim(),
    };
  }
  return null;
}

export function deployedRevisionFromContainerRevisions(containerRevisions) {
  const inspected = containerRevisions.map((item) => ({
    container: item.container,
    revision: normalizeRevision(item.revision),
    error: String(item.error ?? "").trim(),
  }));
  const unreadable = inspected.filter((item) => item.error);
  if (unreadable.length > 0) {
    return {
      revision: "",
      state: "blocked",
      error: `Refusing to deploy Pi images because currently deployed Pi containers could not be inspected: ${unreadable
        .map((item) => `${item.container}=${item.error}`)
        .join("; ")}. Fix Docker/container inspection before updating.`,
    };
  }

  const withRevision = inspected.filter((item) => item.revision);

  if (withRevision.length === 0) {
    return { revision: "", state: "empty" };
  }

  const uniqueRevisions = [...new Set(withRevision.map((item) => item.revision))];
  if (uniqueRevisions.length === 1 && withRevision.length === inspected.length) {
    return { revision: uniqueRevisions[0], state: "matched" };
  }

  return {
    revision: "",
    state: "blocked",
    error: `Refusing to deploy Pi images because currently deployed Pi containers are not the same cooked batch: ${inspected
      .map((item) => `${item.container}=${item.revision || "missing"}`)
      .join("; ")}. Fix the mixed deployment manually; DE_KOI_PI_ALLOW_REVISION cannot repair unreadable or mixed current containers.`,
  };
}

export function checkImageRevisions({
  allowMissingImages = false,
  allowRevision = "",
  currentRevision = "",
  currentRevisionError = "",
  currentRevisionState = "",
  images,
  isAncestor,
}) {
  const currentError = String(currentRevisionError ?? "").trim();
  if (currentError) {
    return {
      ok: false,
      message: currentError,
    };
  }
  if (String(currentRevisionState ?? "").trim() === "blocked") {
    return {
      ok: false,
      message: "Refusing to deploy Pi images because the current Pi deployment state is blocked.",
    };
  }

  const missingImages = [];
  const revisionsByImage = [];
  for (const image of images) {
    const revision = normalizeRevision(image.revision);
    if (!revision) {
      missingImages.push(image.image);
      continue;
    }
    revisionsByImage.push({ image: image.image, revision });
  }

  if (missingImages.length > 0) {
    if (allowMissingImages && missingImages.length === images.length) {
      return {
        ok: true,
        revision: "",
        message: "No cached Pi image batch was detected before pull; continuing to pull prebuilt images.",
      };
    }
    return {
      ok: false,
      message: `Refusing to deploy Pi images: ${missingImages
        .map((image) => `${image} is missing org.opencontainers.image.revision`)
        .join("; ")}`,
    };
  }

  const uniqueRevisions = [...new Set(revisionsByImage.map((image) => image.revision))];
  if (uniqueRevisions.length !== 1) {
    return {
      ok: false,
      message: `Refusing to deploy Pi images because server and web are not the same cooked batch: ${revisionsByImage
        .map((image) => `${image.image}=${image.revision}`)
        .join("; ")}`,
    };
  }

  const revision = uniqueRevisions[0];
  const allowed = normalizeRevision(allowRevision);
  if (allowed && revision === allowed) {
    return {
      ok: true,
      revision,
      message: `Pi images match explicit override revision ${revision}.`,
    };
  }

  const current = normalizeRevision(currentRevision);
  if (!current) {
    return {
      ok: true,
      revision,
      message: `Pi images are a matched cooked batch ${revision}; no deployed image batch was detected.`,
    };
  }

  if (revision === current) {
    return {
      ok: true,
      revision,
      message: `Pi images match the currently deployed cooked batch ${revision}.`,
    };
  }

  const currentIsAncestor = isAncestor(current, revision);
  const candidateIsAncestor = isAncestor(revision, current);

  if (currentIsAncestor === true) {
    return {
      ok: true,
      revision,
      message: `Pi images are a newer cooked batch ${revision}; current deployed batch is ${current}.`,
    };
  }

  if (candidateIsAncestor === true) {
    return {
      ok: false,
      message: `Refusing to deploy older Pi images: candidate ${revision}; current deployed batch is ${current}.`,
    };
  }

  const ancestryFailure = ancestryFailureDetails(currentIsAncestor) || ancestryFailureDetails(candidateIsAncestor);
  if (ancestryFailure) {
    return {
      ok: false,
      message: `Refusing to deploy Pi images because Git history proof failed (${ancestryFailure.code}) for candidate ${revision} and current deployed batch ${current}: ${ancestryFailure.reason}. Fetch or deepen the Pi checkout, then rerun the updater. Set DE_KOI_PI_ALLOW_REVISION=${revision} only for an emergency manual override.`,
    };
  }

  if (currentIsAncestor == null || candidateIsAncestor == null) {
    return {
      ok: false,
      message: `Refusing to deploy Pi images because Git history proof failed (unresolved_ancestry) for candidate ${revision} and current deployed batch ${current}. Fetch or deepen the Pi checkout, then rerun the updater. Set DE_KOI_PI_ALLOW_REVISION=${revision} only for an emergency manual override.`,
    };
  }

  return {
    ok: false,
    message: `Refusing to deploy Pi images because ${revision} could not be proven newer than current deployed batch ${current}. Set DE_KOI_PI_ALLOW_REVISION=${revision} to override manually.`,
  };
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function safeRun(command, args) {
  try {
    return run(command, args);
  } catch {
    return "";
  }
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

function runStatus(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return 0;
  } catch (error) {
    return typeof error.status === "number" ? error.status : 1;
  }
}

function imageRevision(image) {
  return safeRun("docker", [
    "image",
    "inspect",
    image,
    "--format",
    '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
  ]);
}

function isMissingContainerInspect(error) {
  return /No such (object|container)|No such container/i.test(error);
}

function containerRevision(container) {
  const result = safeRunResult("docker", [
    "container",
    "inspect",
    container,
    "--format",
    '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
  ]);
  if (result.ok) {
    return { container, revision: result.output };
  }
  if (isMissingContainerInspect(result.error)) {
    return { container, revision: "" };
  }
  return { container, revision: "", error: result.error || "docker inspect failed" };
}

function parseCsv(value, fallback) {
  const parsed = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function getCurrentRevision() {
  const envRevision = normalizeRevision(process.env.DE_KOI_PI_CURRENT_REVISION);
  if (envRevision) {
    return { revision: envRevision };
  }

  return deployedRevisionFromContainerRevisions(
    parseCsv(process.env.DE_KOI_PI_CONTAINERS, DEFAULT_CONTAINERS).map((container) => containerRevision(container)),
  );
}

function hasCommit(revision) {
  return runStatus("git", ["cat-file", "-e", `${revision}^{commit}`]) === 0;
}

function ancestryFailure(code, reason) {
  return { ok: false, code, reason };
}

function ensureCommit(revision) {
  if (hasCommit(revision)) {
    return { ok: true };
  }

  const fetchStatus = runStatus("git", ["fetch", "--quiet", "origin", revision]);
  if (hasCommit(revision)) {
    return { ok: true };
  }

  const deepenStatus = runStatus("git", ["fetch", "--quiet", "--deepen=100", "origin", "main"]);
  if (hasCommit(revision)) {
    return { ok: true };
  }

  if (fetchStatus !== 0) {
    return ancestryFailure("fetch_failed", `failed to fetch revision ${revision}`);
  }
  if (deepenStatus !== 0) {
    return ancestryFailure("deepen_failed", `failed to deepen main history while looking for revision ${revision}`);
  }
  return ancestryFailure("unresolved_ancestry", `revision ${revision} is unavailable after fetching and deepening main`);
}

function gitAncestor(older, newer) {
  const normalizedOlder = normalizeRevision(older);
  const normalizedNewer = normalizeRevision(newer);
  if (!normalizedOlder || !normalizedNewer) {
    return ancestryFailure("missing_revision", "missing revision for ancestry comparison");
  }

  const olderCommit = ensureCommit(normalizedOlder);
  if (!olderCommit.ok) {
    return olderCommit;
  }
  const newerCommit = ensureCommit(normalizedNewer);
  if (!newerCommit.ok) {
    return newerCommit;
  }

  const status = runStatus("git", ["merge-base", "--is-ancestor", normalizedOlder, normalizedNewer]);
  if (status === 0) {
    return true;
  }
  if (status === 1) {
    return false;
  }
  return ancestryFailure("merge_base_failed", `git merge-base failed with status ${status}`);
}

function main() {
  const current = getCurrentRevision();
  if (process.env.DE_KOI_PI_CHECK_CURRENT_ONLY === "1") {
    if (current.error) {
      console.error(current.error);
      process.exit(1);
    }
    console.log(current.revision ? `Current Pi deployment is a cooked batch ${current.revision}.` : "No deployed Pi image batch was detected.");
    return;
  }

  const images = parseCsv(process.env.DE_KOI_PI_IMAGES, DEFAULT_IMAGES).map((image) => ({
    image,
    revision: imageRevision(image),
  }));
  const result = checkImageRevisions({
    allowMissingImages: process.env.DE_KOI_PI_ALLOW_MISSING_IMAGES === "1",
    allowRevision: process.env.DE_KOI_PI_ALLOW_REVISION,
    currentRevision: current.revision,
    currentRevisionError: current.error,
    currentRevisionState: current.state,
    images,
    isAncestor: gitAncestor,
  });

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
