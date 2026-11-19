import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { decodePng, encodePng, type RawPicture } from "./fixtures/png-rgba";

// Replays recorded screens of the old saved-sprite editors (src/features/catalog/sprites/editors/test-fixtures/
// recorded-screens.json) in the real app against a fake hosted runtime: the same pointer events on the same pictures
// must cause the same sprite_upload calls with the same decoded pixels. Texts are the rebuild's own (decisions 9 and
// 14 changed them), so only calls, arguments, pixels and toasts are compared with the recording.

type JsonRecord = Record<string, unknown>;

interface RecordedImage {
  width: number;
  height: number;
  sha256: string;
}

interface RecordedCall {
  step: string;
  command: string;
  args: { characterId: string; ownerType: string; body: { expression: string; image: string } } | null;
  replyError?: { code: string; message: string };
}

interface RecordedScenario {
  scenario: number;
  calls: RecordedCall[];
  images?: RecordedImage[];
  shown: Array<{ at: string; toasts?: string[] }>;
}

const FIXTURES = "src/features/catalog/sprites/editors/test-fixtures";
const pixelCases = JSON.parse(readFileSync(resolve(FIXTURES, "pixel-cases.json"), "utf8")) as {
  pictures: Record<"A" | "B", { width: number; height: number; rgba: string }>;
};
const screens = JSON.parse(readFileSync(resolve(FIXTURES, "recorded-screens.json"), "utf8")) as {
  scenarios: RecordedScenario[];
};

function recorded(scenario: number): RecordedScenario {
  const found = screens.scenarios.find((entry) => entry.scenario === scenario);
  if (!found) throw new Error(`No recorded scenario ${scenario}`);
  return found;
}

function testPicture(name: "A" | "B"): Buffer {
  const picture = pixelCases.pictures[name];
  return encodePng({
    width: picture.width,
    height: picture.height,
    data: inflateSync(Buffer.from(picture.rgba, "base64")),
  });
}

const character = {
  id: "character-e2e",
  name: "Sprite Koi",
  avatarPath: null,
  data: { name: "Sprite Koi", description: "A test character.", personality: "", first_mes: "" },
};

const persona = { id: "persona-e2e", name: "Sprite Pond", description: "A test persona.", avatarPath: null };

/** The fake runtime: the character's sprite folder, every sprite_upload sent and how to answer the next ones. */
const runtime = {
  files: new Map<string, Buffer>(),
  personaFiles: new Map<string, Buffer>(),
  version: 1,
  uploads: [] as Array<{ characterId: string; ownerType: string; expression: string; picture: RawPicture }>,
  uploadReplies: [] as Array<{ code: string; message: string } | null>,
  reset() {
    this.files = new Map([
      ["happy.png", testPicture("A")],
      ["full_idle.png", testPicture("B")],
    ]);
    this.personaFiles = new Map([["happy.png", testPicture("A")]]);
    this.version = 1;
    this.uploads = [];
    this.uploadReplies = [];
  },
};

function folder(ownerType: unknown): Map<string, Buffer> {
  return ownerType === "persona" ? runtime.personaFiles : runtime.files;
}

function spriteRecord(filename: string, ownerType: string) {
  return {
    expression: filename.replace(/\.png$/, ""),
    filename,
    ownerId: ownerType === "persona" ? persona.id : character.id,
    ownerType,
    size: folder(ownerType).get(filename)?.length ?? 0,
    cacheKey: String(runtime.version),
  };
}

function invoke(command: string, args: JsonRecord): { status?: number; value: unknown } {
  const ownerType = String(args.ownerType ?? "character");
  if (command === "storage_list") {
    return { value: args.entity === "characters" ? [character] : args.entity === "personas" ? [persona] : [] };
  }
  if (command === "storage_get") {
    return { value: args.entity === "characters" ? character : args.entity === "personas" ? persona : null };
  }
  if (command === "sprite_list") {
    return { value: [...folder(ownerType).keys()].sort().map((filename) => spriteRecord(filename, ownerType)) };
  }
  if (command === "sprite_capabilities_command") return { value: {} };
  if (command === "sprite_upload") {
    const body = args.body as { expression: string; image: string };
    const png = Buffer.from(body.image.replace(/^data:image\/png;base64,/, ""), "base64");
    runtime.uploads.push({
      characterId: String(args.characterId),
      ownerType: String(args.ownerType),
      expression: body.expression,
      picture: decodePng(png),
    });
    const failure = runtime.uploadReplies.shift();
    if (failure) return { status: 500, value: failure };
    const filename = `${body.expression}.png`;
    folder(ownerType).set(filename, png);
    runtime.version += 1;
    return { value: { ...spriteRecord(filename, ownerType), absolutePath: `/tmp/${filename}`, url: "" } };
  }
  return { status: 501, value: { message: `Unhandled browser-harness command: ${command}` } };
}

/**
 * Serves the fake runtime on the app's own origin, as the recording's throwaway server did ("<app>/api/assets/…"), so
 * the frame editor's canvas may read the sprite back.
 */
async function routeRuntime(page: Page) {
  await page.route(/\/health/, (route) =>
    route.fulfill({ json: { ok: true, runtime: "de-koi-server", writable: true } }),
  );
  await page.route(/\/api\/invoke$/, async (route) => {
    const body = route.request().postDataJSON() as { command?: string; args?: JsonRecord };
    const result = invoke(String(body.command ?? ""), body.args ?? {});
    await route.fulfill({ status: result.status ?? 200, json: result.value });
  });
  await page.route(/\/api\/assets\/sprite\/(character|persona)\/[^/]+\/[^/?]+/, async (route) => {
    const [, , , ownerType, , filename] = new URL(route.request().url()).pathname.split("/").slice(1);
    const file = folder(ownerType).get(decodeURIComponent(filename ?? ""));
    if (!file) await route.fulfill({ status: 404, json: { message: "Not found" } });
    else await route.fulfill({ status: 200, contentType: "image/png", body: file });
  });
}

test.beforeEach(async ({ page, baseURL }) => {
  runtime.reset();
  await routeRuntime(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(
    ({ url }) => {
      localStorage.setItem(
        "marinara-engine-ui-tauri",
        JSON.stringify({ state: { remoteRuntimeUrl: url, hasCompletedOnboarding: true }, version: 11 }),
      );
    },
    { url: new URL(baseURL ?? "").origin },
  );
});

// ── Driving the editors ─────────────────────────────────────────────────────────────────────────────────────────────

async function openSpritesTab(page: Page, category: "Facial Expressions" | "Full-body" = "Facial Expressions") {
  await page.goto("/");
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "Open Sprite Koi" }).click();
  await page.getByRole("button", { name: "Sprites", exact: true }).click();
  await page.getByRole("button", { name: category, exact: true }).click();
}

function tile(page: Page, stored: string): Locator {
  return page.getByTitle("Open wand cleanup").filter({ has: page.getByAltText(stored, { exact: true }) });
}

async function openCleanup(page: Page, stored: string, label = stored): Promise<Locator> {
  await tile(page, stored).click();
  const dialog = page.getByRole("dialog", { name: `Clean up ${label}` });
  await expect(dialog.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(dialog.getByLabel(`Wand cleanup canvas for ${label}`)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  return dialog;
}

interface Point {
  x: number;
  y: number;
}

/** Client coordinates of picture pixel (x, y) as the recorder sent them: the canvas box + (x + 0.5) × scale. */
async function clientPoint(dialog: Locator, width: number, point: Point) {
  const box = await dialog.locator("canvas").boundingBox();
  if (!box) throw new Error("The cleanup canvas isn't shown");
  const scale = box.width / width;
  return { x: box.x + (point.x + 0.5) * scale, y: box.y + (point.y + 0.5) * scale };
}

async function press(page: Page, dialog: Locator, width: number, point: Point) {
  const at = await clientPoint(dialog, width, point);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function stroke(page: Page, dialog: Locator, width: number, points: Point[]) {
  const [first, ...rest] = await Promise.all(points.map((point) => clientPoint(dialog, width, point)));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
}

async function setSlider(dialog: Locator, name: string, value: number) {
  await dialog.getByRole("slider", { name, exact: true }).fill(String(value));
}

async function chooseTool(dialog: Locator, name: string) {
  await dialog.getByRole("button", { name, exact: true }).click();
}

async function save(page: Page, dialog: Locator) {
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/^(Cleaned|Couldn't|That file)/).first()).toBeVisible();
}

function sha256(picture: RawPicture): string {
  return createHash("sha256").update(picture.data).digest("hex");
}

/** The sprite_upload calls sent, in the recording's terms: arguments plus the decoded picture's size and sha256. */
function uploadsSent() {
  return runtime.uploads.map(({ characterId, ownerType, expression, picture }) => ({
    characterId:
      characterId === character.id ? "<character-id>" : characterId === persona.id ? "<persona-id>" : characterId,
    ownerType,
    expression,
    width: picture.width,
    height: picture.height,
    sha256: sha256(picture),
  }));
}

function uploadsRecorded(scenario: number) {
  const recording = recorded(scenario);
  return recording.calls
    .filter((call) => call.command === "sprite_upload")
    .map((call) => {
      const image = recording.images![Number(call.args!.body.image.replace("image:", ""))];
      return {
        characterId: call.args!.characterId,
        ownerType: call.args!.ownerType,
        expression: call.args!.body.expression,
        width: image.width,
        height: image.height,
        sha256: image.sha256,
      };
    });
}

function toastsRecorded(scenario: number): string[] {
  return recorded(scenario).shown.flatMap((entry) => entry.toasts ?? []);
}

async function expectToast(page: Page, text: string) {
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
}

// ── Scenarios ───────────────────────────────────────────────────────────────────────────────────────────────────────

const A_WIDTH = 96;

test("scenario 1: a wand click with the defaults saves the recorded pixels", async ({ page }) => {
  await openSpritesTab(page);
  const dialog = await openCleanup(page, "happy");
  await expect(dialog.getByRole("button", { name: "Fit to view" })).toHaveText("100%");
  await press(page, dialog, A_WIDTH, { x: 6, y: 6 });
  await expect(dialog.getByRole("status")).toHaveText(
    "6,082 px removed with wand (55% softness, 12% feather) from rgba(240, 240, 240, 255)",
  );
  await save(page, dialog);
  await expectToast(page, toastsRecorded(1)[0]);
  await expect(dialog).toBeHidden();
  expect(uploadsSent()).toEqual(uploadsRecorded(1));
});

test("scenario 2: the strong wand at Tolerance 80, Softness 0, Feather 0", async ({ page }) => {
  await openSpritesTab(page);
  const dialog = await openCleanup(page, "happy");
  await dialog.getByRole("checkbox", { name: "Strong (reaches further)" }).check();
  await setSlider(dialog, "Tolerance", 80);
  await setSlider(dialog, "Softness", 0);
  await setSlider(dialog, "Feather", 0);
  await press(page, dialog, A_WIDTH, { x: 6, y: 6 });
  await save(page, dialog);
  expect(uploadsSent()).toEqual(uploadsRecorded(2));
});

test("scenario 7: an Erase stroke at Brush 18, Opacity 50, Hardness 0", async ({ page }) => {
  await openSpritesTab(page);
  const dialog = await openCleanup(page, "happy");
  await chooseTool(dialog, "Erase");
  await setSlider(dialog, "Opacity", 50);
  await setSlider(dialog, "Hardness", 0);
  await stroke(page, dialog, A_WIDTH, [
    { x: 10, y: 48 },
    { x: 18, y: 47 },
    { x: 25.5, y: 46.25 },
    { x: 31, y: 45 },
    { x: 38.75, y: 44.5 },
    { x: 46, y: 44 },
  ]);
  await save(page, dialog);
  expect(uploadsSent()).toEqual(uploadsRecorded(7));
});

test("scenario 8: Color strokes, picking a colour, and picking a see-through pixel at 156%", async ({ page }) => {
  await openSpritesTab(page);
  const dialog = await openCleanup(page, "happy");
  await chooseTool(dialog, "Brush");
  await dialog.getByLabel("Brush color").fill("#3366cc");
  await setSlider(dialog, "Hardness", 50);
  await stroke(page, dialog, A_WIDTH, [
    { x: 10, y: 48 },
    { x: 18, y: 47 },
    { x: 25.5, y: 46.25 },
    { x: 31, y: 45 },
    { x: 38.75, y: 44.5 },
    { x: 46, y: 44 },
  ]);
  await dialog.getByRole("button", { name: "Pick" }).click();
  await press(page, dialog, A_WIDTH, { x: 48, y: 40 });
  await expect(dialog.getByRole("status")).toHaveText("Brush color picked: rgba(90, 91, 174, 255)");
  await expect(dialog.getByLabel("Brush color")).toHaveValue("#5a5bae");
  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await expect(dialog.getByRole("button", { name: "Fit to view" })).toHaveText("156%");
  await dialog.getByRole("button", { name: "Pick" }).click();
  await press(page, dialog, A_WIDTH, { x: 3, y: 92 });
  await expect(dialog.getByRole("status")).toHaveText("Brush color picked: rgba(0, 0, 0, 0)");
  await expect(dialog.getByLabel("Brush color")).toHaveValue("#000000");
  await stroke(page, dialog, A_WIDTH, [
    { x: 60, y: 20 },
    { x: 70, y: 30 },
  ]);
  await save(page, dialog);
  expect(uploadsSent()).toEqual(uploadsRecorded(8));
});

test("scenario 9: Restore strokes after a wand click, Opacity 100 then 40", async ({ page }) => {
  await openSpritesTab(page);
  const dialog = await openCleanup(page, "happy");
  await press(page, dialog, A_WIDTH, { x: 6, y: 6 });
  await chooseTool(dialog, "Brush");
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  await stroke(page, dialog, A_WIDTH, [
    { x: 4, y: 4 },
    { x: 14, y: 6 },
    { x: 24, y: 10 },
  ]);
  await setSlider(dialog, "Opacity", 40);
  await stroke(page, dialog, A_WIDTH, [
    { x: 70, y: 80 },
    { x: 80, y: 86 },
  ]);
  await save(page, dialog);
  expect(uploadsSent()).toEqual(uploadsRecorded(9));
});

test("scenario 11: Blur at Strength 65 along the edge after a wand click", async ({ page }) => {
  await openSpritesTab(page);
  const dialog = await openCleanup(page, "happy");
  await press(page, dialog, A_WIDTH, { x: 6, y: 6 });
  await chooseTool(dialog, "Blur");
  await stroke(page, dialog, A_WIDTH, [
    { x: 22, y: 30 },
    { x: 30, y: 22 },
    { x: 40, y: 18 },
  ]);
  await save(page, dialog);
  expect(uploadsSent()).toEqual(uploadsRecorded(11));
});

test("scenario 12: an Erase stroke that leaves the picture and comes back", async ({ page }) => {
  await openSpritesTab(page);
  const dialog = await openCleanup(page, "happy");
  await chooseTool(dialog, "Erase");
  await stroke(page, dialog, A_WIDTH, [
    { x: 80, y: 40 },
    { x: 92, y: 42 },
    { x: 104, y: 44 },
    { x: 110, y: 50 },
    { x: 98, y: 56 },
    { x: 88, y: 60 },
  ]);
  await save(page, dialog);
  expect(uploadsSent()).toEqual(uploadsRecorded(12));
});

test("scenario 15: failed saves keep the dialog and the edit; Save sends the same call again", async ({ page }) => {
  await openSpritesTab(page);
  const dialog = await openCleanup(page, "happy");
  await press(page, dialog, A_WIDTH, { x: 6, y: 6 });
  const failures = recorded(15).calls.flatMap((call) => (call.replyError ? [call.replyError] : []));
  runtime.uploadReplies = [...failures];
  const [generic, worded, success] = toastsRecorded(15);

  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expectToast(page, generic);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expectToast(page, worded);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expectToast(page, success);
  await expect(dialog).toBeHidden();
  expect(uploadsSent()).toEqual(uploadsRecorded(15));
});

test("scenario 17: a full-body sprite saves under its full_ name", async ({ page }) => {
  await openSpritesTab(page, "Full-body");
  const dialog = await openCleanup(page, "full_idle", "idle");
  await press(page, dialog, 96, { x: 6, y: 6 });
  await save(page, dialog);
  await expectToast(page, toastsRecorded(17)[0]);
  expect(uploadsSent()).toEqual(uploadsRecorded(17));
});

test("scenario 20: framing crops the saved file by the shown values", async ({ page }) => {
  await openSpritesTab(page);
  await tile(page, "happy").hover();
  await page.getByRole("button", { name: "Frame", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Frame happy" });
  await expect(panel.getByRole("heading", { name: "Frame happy" })).toBeFocused();
  await setSlider(panel, "Top", 10);
  await setSlider(panel, "Left", 80);
  await setSlider(panel, "Right", 20);
  await expect(panel.getByRole("slider", { name: "Left" })).toHaveValue("70");
  await setSlider(panel, "Bottom", 5);
  await expect(panel.getByRole("img", { name: "Framed preview of happy" })).toHaveJSProperty("naturalWidth", 10);
  await panel.getByRole("button", { name: "Apply frame" }).click();
  await expectToast(page, toastsRecorded(20)[0]);
  await expect(panel).toBeHidden();
  expect(uploadsSent()).toEqual(uploadsRecorded(20));
});

test("scenario 19: a persona's sprite saves to the persona", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("tab", { name: "Personas" }).click();
  await page.getByText("Sprite Pond", { exact: true }).first().click();
  await page.getByRole("button", { name: "Sprites", exact: true }).click();
  const dialog = await openCleanup(page, "happy");
  await press(page, dialog, A_WIDTH, { x: 6, y: 6 });
  await save(page, dialog);
  await expectToast(page, toastsRecorded(19)[0]);
  expect(uploadsSent()).toEqual(uploadsRecorded(19));
});
