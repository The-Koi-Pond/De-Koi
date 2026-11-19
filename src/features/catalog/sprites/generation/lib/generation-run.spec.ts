import { describe, expect, it } from "vitest";

import { planMatchedBatches } from "./matched-batches";
import {
  batchProgressLine,
  cleanSprites,
  requestSheet,
  runMatchedBatches,
  type GenerationPorts,
  type SheetReply,
} from "./generation-run";
import type { SpriteGenerationBody } from "./request-bodies";
import { spriteErrorMessage, SpriteCheckError } from "./sprite-errors";

type Sent = { command: string; body: unknown };

function fakePorts(replies: Array<SheetReply | Error>, options: Partial<GenerationPorts> = {}) {
  const sent: Sent[] = [];
  let id = 0;
  const ports: GenerationPorts = {
    reviewPrompts: false,
    preview: async (body) => {
      sent.push({ command: "preview", body });
      return { items: [] };
    },
    generate: async (body) => {
      sent.push({ command: "generate", body });
      const reply = replies.shift();
      if (!reply) throw new Error("no reply left");
      if (reply instanceof Error) throw reply;
      return reply;
    },
    review: async () => null,
    cleanup: async (body) => {
      sent.push({ command: "cleanup", body });
      return { cells: body.cells.map(() => ({ base64: "clean" })) };
    },
    nextId: () => `id-${(id += 1)}`,
    ...options,
  };
  return { ports, sent };
}

function cells(names: string[]): SheetReply {
  return { sheetBase64: "sheet", cells: names.map((name, index) => ({ expression: name, base64: `cell${index}` })) };
}

const template = {
  connectionId: "c",
  appearance: "look",
  referenceImages: [],
  spriteType: "full-body" as const,
  matched: true,
  nativeTransparentPng: false,
  negativePrompt: "neg",
};

const names = ["angry", "happy", "neutral", "smirk", "very_sad", "thinking"];

function generic(): Error {
  return Object.assign(new Error("boom"), { details: { code: "some_internal_error" } });
}

describe("one request", () => {
  const body = { expressions: ["neutral"] } as unknown as SpriteGenerationBody;

  it("previews, opens the review and sends the overrides when the review is on", async () => {
    const overrides = [{ id: "x", prompt: "edited" }];
    const { ports, sent } = fakePorts([cells(["neutral"])], {
      reviewPrompts: true,
      preview: async (previewBody) => {
        sent.push({ command: "preview", body: previewBody });
        return { items: [{ id: "x", kind: "sprite", title: "t", prompt: "p", width: 1, height: 1 }] };
      },
      review: async () => overrides,
    });
    await requestSheet(body, ports);
    expect(sent.map((item) => item.command)).toEqual(["preview", "generate"]);
    expect((sent[1].body as SpriteGenerationBody).promptOverrides).toBe(overrides);
  });

  it("sends nothing more when the review is cancelled, and the plain request when the preview is empty", async () => {
    const cancelled = fakePorts([], {
      reviewPrompts: true,
      preview: async () => ({ items: [{ id: "x", kind: "sprite", title: "t", prompt: "p", width: 1, height: 1 }] }),
    });
    expect(await requestSheet(body, cancelled.ports)).toBeNull();
    expect(cancelled.sent).toEqual([]);

    const empty = fakePorts([cells(["neutral"])], { reviewPrompts: true });
    await requestSheet(body, empty.ports);
    expect(empty.sent.map((item) => item.command)).toEqual(["preview", "generate"]);
    expect(Object.keys(empty.sent[1].body as object)).not.toContain("promptOverrides");
  });
});

describe("cleanup", () => {
  it("sends originals and keeps a sprite's picture when its reply cell has none", async () => {
    const sprites = [
      { id: "1", name: "a", original: "o1", shown: "s1", selected: true, sheetIndex: 0, position: 0 },
      { id: "2", name: "b", original: "o2", shown: "s2", selected: false, sheetIndex: 0, position: 1 },
    ];
    const bodies: unknown[] = [];
    const cleaned = await cleanSprites(sprites, 35, async (body) => {
      bodies.push(body);
      return { cells: [{ base64: "c1" }, {}] };
    });
    expect(bodies).toEqual([
      {
        cleanupStrength: 35,
        engine: "auto",
        cells: [
          { expression: "a", base64: "o1" },
          { expression: "b", base64: "o2" },
        ],
      },
    ]);
    expect(cleaned.map((sprite) => sprite.shown)).toEqual(["data:image/png;base64,c1", "s2"]);
  });
});

describe("matched batches", () => {
  const batches = planMatchedBatches(names);

  it("runs every batch in order and collects each batch's sprites and sheet", async () => {
    const { ports, sent } = fakePorts([cells(names.slice(0, 4)), cells(names.slice(4))]);
    const progress: string[] = [];
    const result = await runMatchedBatches({
      batches,
      startIndex: 0,
      template,
      collected: { sprites: [], sheets: [] },
      ports,
      cleanupSettings: () => ({ enabled: false, strength: 35 }),
      onProgress: (line) => progress.push(line),
      isCurrent: () => true,
    });
    expect(result.failure).toBeNull();
    expect(result.sprites.map((sprite) => sprite.name)).toEqual(names);
    expect(result.sheets.map((sheet) => [sheet.label, sheet.grid])).toEqual([
      ["Batch 1", { cols: 2, rows: 2 }],
      ["Batch 2", { cols: 2, rows: 1 }],
    ]);
    expect(result.sprites[5]).toMatchObject({ sheetIndex: 1, position: 1 });
    expect(sent.map((item) => (item.body as SpriteGenerationBody).expressions)).toEqual([
      names.slice(0, 4),
      names.slice(4),
    ]);
    expect(progress).toEqual(["Batch 1 of 2: angry, happy, neutral, smirk", "Batch 2 of 2: very sad, thinking"]);
  });

  it.each([
    ["a failed request", generic(), "Image generation failed. Try again."],
    [
      "failed expressions",
      { ...cells(["very_sad", "thinking"]), failedExpressions: [{ expression: "very_sad", error: "content policy" }] },
      "very_sad: content policy",
    ],
    ["too few cells", cells(["very_sad"]), "The provider returned fewer sprites than requested"],
  ])("pauses a batch after two tries with %s", async (_label, failure, reason) => {
    const { ports, sent } = fakePorts([cells(names.slice(0, 4)), failure, failure]);
    const progress: string[] = [];
    const result = await runMatchedBatches({
      batches,
      startIndex: 0,
      template,
      collected: { sprites: [], sheets: [] },
      ports,
      cleanupSettings: () => ({ enabled: false, strength: 35 }),
      onProgress: (line) => progress.push(line),
      isCurrent: () => true,
    });
    expect(sent).toHaveLength(3);
    expect(progress[2]).toBe("Batch 2 of 2 (retrying once): very sad, thinking");
    expect(result.failure).toEqual({
      batchIndex: 1,
      message: `Batch 2 of 2 failed after one automatic retry: ${reason}`,
    });
    expect(result.sprites.map((sprite) => sprite.name)).toEqual(names.slice(0, 4));

    const retry = fakePorts([cells(names.slice(4))]);
    const resumed = await runMatchedBatches({
      batches,
      startIndex: result.failure!.batchIndex,
      template,
      collected: result,
      ports: retry.ports,
      cleanupSettings: () => ({ enabled: false, strength: 35 }),
      onProgress: () => {},
      isCurrent: () => true,
    });
    expect(resumed.failure).toBeNull();
    expect(resumed.sprites.map((sprite) => sprite.name)).toEqual(names);
    expect(resumed.sheets.map((sheet) => sheet.label)).toEqual(["Batch 1", "Batch 2"]);
  });

  it("cleans a batch inside its try, and a cleanup failure keeps the batch uncleaned instead of paying again", async () => {
    let cleanups = 0;
    const { ports, sent } = fakePorts([cells(["a", "b", "c", "d"]), cells(["e"])], {
      cleanup: async (body) => {
        sent.push({ command: "cleanup", body });
        cleanups += 1;
        if (cleanups === 1) throw generic();
        return { cells: body.cells.map(() => ({ base64: "clean" })) };
      },
    });
    const result = await runMatchedBatches({
      batches: planMatchedBatches(["a", "b", "c", "d", "e"]),
      startIndex: 0,
      template,
      collected: { sprites: [], sheets: [] },
      ports,
      cleanupSettings: () => ({ enabled: true, strength: 50 }),
      onProgress: () => {},
      isCurrent: () => true,
    });
    expect(sent.map((item) => item.command)).toEqual(["generate", "cleanup", "generate", "cleanup"]);
    expect(result.failure).toBeNull();
    expect(result.sprites.map((sprite) => sprite.shown)).toEqual([
      "data:image/png;base64,cell0",
      "data:image/png;base64,cell1",
      "data:image/png;base64,cell2",
      "data:image/png;base64,cell3",
      "data:image/png;base64,clean",
    ]);
    expect(result.cleaned).toBe(true);
    expect(result.note).toBe("Couldn't remove the background. Use Apply cleanup to try again.");
  });

  it("stops at a cancelled review: no second preview, nothing more sent, the batches before it kept", async () => {
    let previews = 0;
    const { ports, sent } = fakePorts([cells(names.slice(0, 4))], {
      reviewPrompts: true,
      preview: async (body) => {
        previews += 1;
        sent.push({ command: "preview", body });
        return { items: [{ id: "x", kind: "sprite", title: "t", prompt: "p", width: 1, height: 1 }] };
      },
      review: async () => (previews === 1 ? [] : null),
    });
    const result = await runMatchedBatches({
      batches,
      startIndex: 0,
      template,
      collected: { sprites: [], sheets: [] },
      ports,
      cleanupSettings: () => ({ enabled: false, strength: 35 }),
      onProgress: () => {},
      isCurrent: () => true,
    });
    expect(sent.map((item) => item.command)).toEqual(["preview", "generate", "preview"]);
    expect(result.failure).toBeNull();
    expect(result.cancelledAt).toBe(1);
    expect(result.stale).toBe(false);
    expect(result.sprites.map((sprite) => sprite.name)).toEqual(names.slice(0, 4));
  });

  it("sends nothing more once the run is no longer current", async () => {
    let current = true;
    const { ports, sent } = fakePorts([cells(names.slice(0, 4)), cells(names.slice(4))], {
      generate: async (body) => {
        sent.push({ command: "generate", body });
        current = false; // e.g. the owner changed while this batch was being generated
        return cells(names.slice(0, 4));
      },
    });
    const result = await runMatchedBatches({
      batches,
      startIndex: 0,
      template,
      collected: { sprites: [], sheets: [] },
      ports,
      cleanupSettings: () => ({ enabled: true, strength: 35 }),
      onProgress: () => {},
      isCurrent: () => current,
    });
    expect(sent.map((item) => item.command)).toEqual(["generate", "cleanup"]);
    expect(result.stale).toBe(true);
  });

  it("words the progress line with spaces", () => {
    expect(batchProgressLine(0, 3, ["very_sad"], true)).toBe("Batch 1 of 3 (retrying once): very sad");
  });
});

describe("error words", () => {
  it("shows the dialog's own checks and the two Rust sprite codes in their own words", () => {
    expect(spriteErrorMessage(new SpriteCheckError("own words"), "fallback")).toBe("own words");
    const timeout = Object.assign(new Error("Sprite generation timed out after 240 seconds"), {
      details: { code: "sprite_generation_timeout" },
    });
    expect(spriteErrorMessage(timeout, "fallback")).toBe(
      "Sprite generation took longer than 240 seconds. Try again, or pick a smaller grid.",
    );
    const allFailed = Object.assign(new Error("All expression generations failed"), {
      details: { code: "sprite_generation_failed" },
    });
    expect(spriteErrorMessage(allFailed, "fallback")).toBe(
      "None of the sprites could be generated. Try again, or pick another connection.",
    );
  });

  it("shows worded provider errors and the fallback for anything else", () => {
    const worded = Object.assign(new Error("Provider says: quota exceeded"), {
      details: { code: "image_provider_error" },
    });
    expect(spriteErrorMessage(worded, "fallback")).toBe("Provider says: quota exceeded");
    expect(spriteErrorMessage(generic(), "fallback")).toBe("fallback");
  });
});
