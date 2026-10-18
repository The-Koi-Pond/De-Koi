// Retakes the README screenshots from the current build with the demo cast and chats (no model or network needed).
//   pnpm build && cargo build --manifest-path src-tauri/Cargo.toml --bin de-koi-server
//   pnpm docs:readme-screenshots
// Starts de-koi-server on a throwaway data folder, serves dist/ in front of it, seeds docs/screenshots/demo, and writes
// docs/screenshots/readme/. Set DE_KOI_SERVER_BIN to use a server binary from somewhere else.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DEMO_PERSONA } from "./cast.mjs";
import { runtimeClient, seedCast, seedChats } from "./runtime.mjs";

const OUT_DIR = "docs/screenshots/readme";
const DIST = path.resolve("dist");
const DESKTOP = { width: 1440, height: 900 };
const ROLEPLAY = { width: 1440, height: 1300 };
const PHONE = { width: 390, height: 844 };
const FIC = "Before the Lamps Are Lit";

function serverBinary() {
  if (process.env.DE_KOI_SERVER_BIN) return process.env.DE_KOI_SERVER_BIN;
  const target = process.env.CARGO_TARGET_DIR ?? path.join("src-tauri", "target");
  return path.join(target, "debug", process.platform === "win32" ? "de-koi-server.exe" : "de-koi-server");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000}s`);
}

const CONTENT_TYPES = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

/** Serves dist/ and forwards the runtime API to de-koi-server on the same origin, like the Pi's nginx does. */
function startWebShell(port, runtimePort) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const file = path.join(DIST, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    const isRuntime = url.pathname.startsWith("/api/") || url.pathname === "/health";
    if (!isRuntime && file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
      response.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
      createReadStream(file).pipe(response);
      return;
    }
    const runtimeOrigin = `http://127.0.0.1:${runtimePort}`;
    const headers = { ...request.headers, host: `127.0.0.1:${runtimePort}` };
    if (headers.origin) headers.origin = runtimeOrigin;
    delete headers.referer;
    const upstream = http.request(
      { host: "127.0.0.1", port: runtimePort, path: request.url, method: request.method, headers },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      },
    );
    upstream.on("error", (error) => {
      response.writeHead(502);
      response.end(String(error));
    });
    request.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

/** Waits until the app has loaded its chat list (desktop and phone both show the mode tabs). */
async function waitForApp(page) {
  await page.getByRole("button", { name: "Fanfic", exact: true }).first().waitFor();
  await page.waitForTimeout(1500);
}

async function openChat(page, tab, name) {
  await page.getByRole("button", { name: tab, exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.getByText(name, { exact: true }).locator("visible=true").first().click();
  await page.waitForTimeout(2500);
}

/** Scrolls every scrolled area back to its top, and parks the pointer where it hovers nothing. */
async function settle(page, { top = true } = {}) {
  if (top) {
    await page.evaluate(() => {
      for (const element of document.querySelectorAll("*")) {
        if (element.scrollTop > 0) element.scrollTop = 0;
      }
    });
  }
  await page.mouse.move(Math.round(page.viewportSize().width / 2), 18);
  await page.waitForTimeout(800);
}

async function capture(browser, base) {
  const desktop = await browser.newContext({ viewport: DESKTOP, colorScheme: "dark", deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  await page.goto(base);
  await waitForApp(page);

  // Taller, and scrolled to the end, so the whole exchange fits and no text sits under the floating composer.
  await page.setViewportSize(ROLEPLAY);
  await openChat(page, "Roleplay", "The Halcyon");
  await settle(page, { top: false });
  await page.screenshot({ path: `${OUT_DIR}/roleplay.jpg`, type: "jpeg", quality: 85 });
  await page.setViewportSize(DESKTOP);

  await openChat(page, "Conversation", "Wren");
  await settle(page, { top: false });
  await page.screenshot({ path: `${OUT_DIR}/conversation.png` });

  await openChat(page, "Fanfic", FIC);
  await settle(page);
  await page.screenshot({ path: `${OUT_DIR}/fanfic-reader.png` });

  await page.getByRole("button", { name: "New fic" }).click();
  await page.locator("#fanfic-fandom").waitFor();
  await fillFicRequest(page);
  await settle(page);
  await page.screenshot({ path: `${OUT_DIR}/fanfic-request.png` });
  await desktop.close();
}

async function fillFicRequest(page) {
  const request = JSON.parse(await readFile("docs/screenshots/demo/chats.json", "utf8")).find(
    (chat) => chat.name === FIC,
  )?.metadata?.fanfic?.request;
  if (!request) throw new Error(`The demo fic "${FIC}" has no saved request`);
  await page.locator("#fanfic-fandom").fill(request.fandom ?? "");
  await page.locator("#fanfic-prompt").fill(request.prompt ?? "");
  const add = async (label, value) => {
    const box = page.locator(`input[aria-label="${label}"], input[placeholder="${label}"]`).first();
    await box.fill(value);
    await box.press("Enter");
  };
  for (const ship of request.relationships ?? []) await add("Add a relationship", ship);
  for (const character of request.characters ?? []) await add("Add a character", character);
  for (const tag of request.tags ?? []) await add("Add a trope or tag", tag);
  const rating = { general: "General", teen: "Teen", mature: "Mature", explicit: "Explicit" }[request.rating];
  if (rating) await page.getByText(rating, { exact: true }).first().click();
}

async function capturePhone(browser, base) {
  const phone = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  const shots = [];
  for (const [tab, name, top] of [
    ["Conversation", "Wren", false],
    ["Roleplay", "The Halcyon", false],
    ["Fanfic", FIC, true],
  ]) {
    const page = await phone.newPage();
    await page.goto(base);
    await waitForApp(page);
    await openChat(page, tab, name);
    await settle(page, { top });
    shots.push((await page.screenshot()).toString("base64"));
    await page.close();
  }
  // Lay the three phone screens side by side on one image.
  const sheet = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  await sheet.setContent(`<!doctype html><body style="margin:0;background:#0b1418;display:flex;gap:48px;justify-content:center;align-items:center;height:980px">
    ${shots.map((shot) => `<img src="data:image/png;base64,${shot}" style="width:390px;border-radius:28px;box-shadow:0 12px 40px #0008;border:6px solid #1f2d33">`).join("")}
  </body>`);
  await sheet.waitForTimeout(300);
  await sheet.screenshot({ path: `${OUT_DIR}/phone.jpg`, type: "jpeg", quality: 85 });
  await sheet.close();
  await phone.close();
}

async function main() {
  const binary = serverBinary();
  if (!existsSync(binary)) {
    throw new Error(
      `No de-koi-server at ${binary}. Build it with \`cargo build --manifest-path src-tauri/Cargo.toml --bin de-koi-server\` or set DE_KOI_SERVER_BIN.`,
    );
  }
  if (!existsSync(path.join(DIST, "index.html"))) throw new Error("No dist/ build. Run `pnpm build` first.");

  const dataDir = await mkdtemp(path.join(os.tmpdir(), "de-koi-readme-"));
  const runtimePort = await freePort();
  const webPort = await freePort();
  const runtimeBase = `http://127.0.0.1:${runtimePort}`;
  const webBase = `http://127.0.0.1:${webPort}`;
  const origins = `${runtimeBase},${webBase}`;
  const runtime = spawn(binary, [], {
    env: {
      ...process.env,
      DE_KOI_DATA_DIR: dataDir,
      DE_KOI_SERVER_ADDR: `127.0.0.1:${runtimePort}`,
      CORS_ORIGINS: origins,
      CSRF_TRUSTED_ORIGINS: origins,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let runtimeErrors = "";
  runtime.stderr.on("data", (chunk) => (runtimeErrors = (runtimeErrors + chunk).slice(-4000)));
  const web = await startWebShell(webPort, runtimePort);
  let browser;
  try {
    await waitFor(`${runtimeBase}/health`).catch((error) => {
      throw new Error(`${error.message}\n${runtimeErrors}`);
    });
    const invoke = runtimeClient(runtimeBase);
    const characterIds = await seedCast(invoke);
    const chats = JSON.parse(await readFile("docs/screenshots/demo/chats.json", "utf8"));
    await seedChats(invoke, chats, characterIds);
    console.log(
      `Seeded the demo cast (${DEMO_PERSONA.name} + ${Object.keys(characterIds).length} characters) and ${chats.length} chats.`,
    );

    await mkdir(OUT_DIR, { recursive: true });
    browser = await chromium.launch();
    await capture(browser, webBase);
    await capturePhone(browser, webBase);
    console.log(`Wrote ${OUT_DIR}/roleplay.jpg, conversation.png, fanfic-reader.png, fanfic-request.png, phone.jpg`);
  } finally {
    await browser?.close();
    web.close();
    runtime.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await rm(dataDir, { recursive: true, force: true }).catch((error) =>
      console.warn(`Could not remove the temporary data folder ${dataDir}: ${error.message}`),
    );
  }
}

await main();
