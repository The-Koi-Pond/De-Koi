// Builds and verifies the signed Tauri updater manifest (latest.json) for a release.
//
//   node scripts/release-updater-manifest.mjs build  --dir <assets> --version <x.y.z> --base-url <url> [--notes <text>] --out <file>
//   node scripts/release-updater-manifest.mjs verify --dir <assets> --manifest <file> --pubkey <base64 minisign key>
//
// `build` maps each bundle that has a `.sig` next to it to the updater platform
// keys the Tauri updater looks up (`{os}-{arch}-{installer}`, then `{os}-{arch}`).
// `verify` checks every manifest signature against the public key, so a release
// can't ship an update that installed apps would reject (or one signed by the
// wrong key).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every release must carry these. A missing one fails the build instead of
// silently leaving those installs without updates.
export const REQUIRED_PLATFORMS = ["windows-x86_64-nsis", "linux-x86_64-appimage"];

const BUNDLE_RULES = [
  // Releases ship only the NSIS installer on Windows, so the bare key is safe too.
  { pattern: /windows-x64.*-setup\.exe$/i, platforms: ["windows-x86_64-nsis", "windows-x86_64"] },
  // No bare linux key: an AppImage must never be offered to a .deb or .rpm install.
  { pattern: /linux-x64.*\.AppImage$/, platforms: ["linux-x86_64-appimage"] },
  { pattern: /linux-x64.*\.deb$/i, platforms: ["linux-x86_64-deb"] },
  { pattern: /linux-x64.*\.rpm$/i, platforms: ["linux-x86_64-rpm"] },
];

export function buildManifest({ files, readSignature, version, baseUrl, notes = "", pubDate = new Date() }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`version must be x.y.z, got "${version}"`);
  }
  const platforms = {};
  const names = new Set(files);
  for (const name of [...names].sort()) {
    if (name.endsWith(".sig")) continue;
    const rule = BUNDLE_RULES.find(({ pattern }) => pattern.test(name));
    if (!rule) continue;
    if (!names.has(`${name}.sig`)) {
      throw new Error(`${name} has no ${name}.sig; updater bundles must be signed`);
    }
    const entry = {
      signature: readSignature(`${name}.sig`).trim(),
      url: `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(name)}`,
    };
    for (const platform of rule.platforms) {
      if (platforms[platform]) {
        throw new Error(`two bundles map to ${platform}: ${platforms[platform].url} and ${entry.url}`);
      }
      platforms[platform] = entry;
    }
  }
  const missing = REQUIRED_PLATFORMS.filter((platform) => !platforms[platform]);
  if (missing.length > 0) {
    throw new Error(`release is missing signed updater bundles for: ${missing.join(", ")}`);
  }
  return { version, notes, pub_date: pubDate.toISOString(), platforms };
}

function decodeMinisignLines(base64Text, label) {
  const text = Buffer.from(base64Text.trim(), "base64").toString("utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2 || !lines[0].startsWith("untrusted comment:")) {
    throw new Error(`${label} is not a base64-encoded minisign file`);
  }
  return lines;
}

function ed25519PublicKey(raw) {
  // SPKI DER prefix for a raw 32-byte Ed25519 public key.
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({ key: Buffer.concat([prefix, raw]), format: "der", type: "spki" });
}

export function parsePublicKey(base64Key) {
  const [, keyLine] = decodeMinisignLines(base64Key, "public key");
  const bytes = Buffer.from(keyLine, "base64");
  if (bytes.length !== 42 || bytes.subarray(0, 2).toString("latin1") !== "Ed") {
    throw new Error("public key is not a minisign Ed25519 key");
  }
  return { keyId: bytes.subarray(2, 10), key: ed25519PublicKey(bytes.subarray(10)) };
}

// Verifies a Tauri updater signature (a base64-encoded minisign signature file).
export function verifySignature({ data, signature, publicKey }) {
  const lines = decodeMinisignLines(signature, "signature");
  if (lines.length < 4 || !lines[2].startsWith("trusted comment: ")) {
    throw new Error("signature is missing its trusted comment");
  }
  const sigBytes = Buffer.from(lines[1], "base64");
  if (sigBytes.length !== 74) throw new Error("signature has the wrong length");
  const algorithm = sigBytes.subarray(0, 2).toString("latin1");
  const keyId = sigBytes.subarray(2, 10);
  const sig = sigBytes.subarray(10);
  if (!keyId.equals(publicKey.keyId)) {
    throw new Error(
      `signed by key ${Buffer.from(keyId).reverse().toString("hex").toUpperCase()}, not the release key ${Buffer.from(publicKey.keyId).reverse().toString("hex").toUpperCase()}`,
    );
  }
  let message;
  if (algorithm === "ED") message = crypto.createHash("blake2b512").update(data).digest();
  else if (algorithm === "Ed") message = data;
  else throw new Error(`unknown signature algorithm "${algorithm}"`);
  if (!crypto.verify(null, message, publicKey.key, sig)) {
    throw new Error("file signature does not match");
  }
  const trustedComment = Buffer.from(lines[2].slice("trusted comment: ".length), "utf8");
  const globalSig = Buffer.from(lines[3], "base64");
  if (!crypto.verify(null, Buffer.concat([sig, trustedComment]), publicKey.key, globalSig)) {
    throw new Error("trusted comment signature does not match");
  }
}

export function verifyManifest({ manifest, readFile, publicKey }) {
  const missing = REQUIRED_PLATFORMS.filter((platform) => !manifest.platforms?.[platform]);
  if (missing.length > 0) throw new Error(`manifest is missing: ${missing.join(", ")}`);
  const checked = [];
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    const name = decodeURIComponent(new URL(entry.url).pathname.split("/").pop());
    try {
      verifySignature({ data: readFile(name), signature: entry.signature, publicKey });
    } catch (error) {
      throw new Error(`${platform} (${name}): ${error.message}`);
    }
    checked.push(`${platform} -> ${name}`);
  }
  return checked;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag.startsWith("--") || index + 1 >= argv.length) throw new Error(`bad argument: ${flag}`);
    options[flag.slice(2)] = argv[index + 1];
  }
  return options;
}

function requireOptions(options, ...names) {
  for (const name of names) {
    if (!options[name]) throw new Error(`missing --${name}`);
  }
}

function main([command, ...rest]) {
  const options = parseArgs(rest);
  if (command === "build") {
    requireOptions(options, "dir", "version", "base-url", "out");
    const manifest = buildManifest({
      files: fs.readdirSync(options.dir),
      readSignature: (name) => fs.readFileSync(path.join(options.dir, name), "utf8"),
      version: options.version,
      baseUrl: options["base-url"],
      notes: options.notes ?? "",
    });
    fs.writeFileSync(options.out, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${options.out} with ${Object.keys(manifest.platforms).join(", ")}`);
  } else if (command === "verify") {
    requireOptions(options, "dir", "manifest", "pubkey");
    const checked = verifyManifest({
      manifest: JSON.parse(fs.readFileSync(options.manifest, "utf8")),
      readFile: (name) => fs.readFileSync(path.join(options.dir, name)),
      publicKey: parsePublicKey(options.pubkey),
    });
    for (const line of checked) console.log(`signature ok: ${line}`);
  } else {
    throw new Error('first argument must be "build" or "verify"');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-updater-manifest: ${error.message}`);
    process.exit(1);
  }
}
