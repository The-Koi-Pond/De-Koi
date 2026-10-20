import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, test } from "node:test";

import { buildManifest, parsePublicKey, verifyManifest, verifySignature } from "./release-updater-manifest.mjs";

// Builds a minisign key pair and signer shaped like `tauri signer` output.
function makeSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyId = crypto.randomBytes(8);
  const keyFile = `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from("Ed"), keyId, rawPublic]).toString("base64")}\n`;
  const sign = (data, { tamperComment = false } = {}) => {
    const sig = crypto.sign(null, crypto.createHash("blake2b512").update(data).digest(), privateKey);
    const comment = "timestamp:1\tfile:bundle";
    const globalSig = crypto.sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey);
    const text = [
      "untrusted comment: signature from tauri secret key",
      Buffer.concat([Buffer.from("ED"), keyId, sig]).toString("base64"),
      `trusted comment: ${tamperComment ? `${comment}x` : comment}`,
      globalSig.toString("base64"),
      "",
    ].join("\n");
    return Buffer.from(text).toString("base64");
  };
  return { publicKeyBase64: Buffer.from(keyFile).toString("base64"), sign };
}

const BASE = "https://github.com/The-Koi-Pond/De-Koi/releases/download/v1.7.0";
const WINDOWS = "De-Koi_1.7.0_windows-x64-setup.exe";
const APPIMAGE = "De-Koi_1.7.0_linux-x64.AppImage";
const DEB = "De-Koi_1.7.0_linux-x64.deb";

function assets(signer, extra = {}) {
  const bytes = { [WINDOWS]: Buffer.from("windows installer"), [APPIMAGE]: Buffer.from("appimage"), ...extra };
  const signatures = Object.fromEntries(
    Object.entries(bytes).map(([name, data]) => [`${name}.sig`, signer.sign(data)]),
  );
  return { bytes, signatures, files: [...Object.keys(bytes), ...Object.keys(signatures)] };
}

describe("buildManifest", () => {
  test("maps signed bundles to installer-specific updater keys", () => {
    const signer = makeSigner();
    const { files, signatures } = assets(signer, { [DEB]: Buffer.from("deb") });
    const manifest = buildManifest({
      files,
      readSignature: (name) => signatures[name],
      version: "1.7.0",
      baseUrl: `${BASE}/`,
      pubDate: new Date("2026-10-20T00:00:00Z"),
    });
    assert.deepEqual(Object.keys(manifest.platforms).sort(), [
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "windows-x86_64",
      "windows-x86_64-nsis",
    ]);
    assert.equal(manifest.platforms["windows-x86_64-nsis"].url, `${BASE}/${WINDOWS}`);
    assert.equal(manifest.platforms["linux-x86_64"], undefined, "an AppImage must not be offered to deb/rpm installs");
    assert.equal(manifest.pub_date, "2026-10-20T00:00:00.000Z");
  });

  test("fails when a bundle has no signature", () => {
    assert.throws(
      () =>
        buildManifest({
          files: [WINDOWS, APPIMAGE, `${APPIMAGE}.sig`],
          readSignature: () => "x",
          version: "1.7.0",
          baseUrl: BASE,
        }),
      /has no .*\.sig/,
    );
  });

  test("fails when a required platform is missing", () => {
    assert.throws(
      () =>
        buildManifest({
          files: [APPIMAGE, `${APPIMAGE}.sig`],
          readSignature: () => "x",
          version: "1.7.0",
          baseUrl: BASE,
        }),
      /missing signed updater bundles for: windows-x86_64-nsis/,
    );
  });

  test("rejects a non x.y.z version", () => {
    assert.throws(
      () => buildManifest({ files: [], readSignature: () => "", version: "1.7.0-beta.1", baseUrl: BASE }),
      /version must be x\.y\.z/,
    );
  });
});

describe("verifyManifest", () => {
  function build(signer, { bytes, signatures, files }) {
    return buildManifest({ files, readSignature: (name) => signatures[name], version: "1.7.0", baseUrl: BASE });
  }

  test("accepts bundles signed by the release key", () => {
    const signer = makeSigner();
    const set = assets(signer);
    const checked = verifyManifest({
      manifest: build(signer, set),
      readFile: (name) => set.bytes[name],
      publicKey: parsePublicKey(signer.publicKeyBase64),
    });
    assert.equal(checked.length, 3);
  });

  test("rejects a bundle changed after signing", () => {
    const signer = makeSigner();
    const set = assets(signer);
    assert.throws(
      () =>
        verifyManifest({
          manifest: build(signer, set),
          readFile: (name) => (name === WINDOWS ? Buffer.from("tampered") : set.bytes[name]),
          publicKey: parsePublicKey(signer.publicKeyBase64),
        }),
      /windows-x86_64.*file signature does not match/,
    );
  });

  test("rejects bundles signed by a different key", () => {
    const releaseKey = makeSigner();
    const otherKey = makeSigner();
    const set = assets(otherKey);
    assert.throws(
      () =>
        verifyManifest({
          manifest: build(otherKey, set),
          readFile: (name) => set.bytes[name],
          publicKey: parsePublicKey(releaseKey.publicKeyBase64),
        }),
      /not the release key/,
    );
  });

  test("rejects an edited trusted comment", () => {
    const signer = makeSigner();
    const data = Buffer.from("bundle");
    assert.throws(
      () =>
        verifySignature({
          data,
          signature: signer.sign(data, { tamperComment: true }),
          publicKey: parsePublicKey(signer.publicKeyBase64),
        }),
      /trusted comment signature does not match/,
    );
  });
});
