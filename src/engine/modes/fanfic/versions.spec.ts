import { describe, expect, it } from "vitest";

import type { FanficModelRecord } from "../../contracts/types/fanfic";
import { fanficModelLabel, readFanficVersion } from "./versions";

const WRITER: FanficModelRecord = { connectionId: "conn-a", name: "Writer", model: "big-model" };
const DRAFTER: FanficModelRecord = { connectionId: "conn-b", name: "Drafter", model: "small-model" };

describe("readFanficVersion", () => {
  it("reads a stored version with its models, origin and unfinished state", () => {
    const extra = {
      thinking: "unrelated",
      fanficVersion: {
        models: [WRITER, DRAFTER],
        origin: { kind: "revise", notes: "Snarkier.", baseVersion: 0 },
        unfinished: { reason: "provider_reset", code: "llm_stream_text_reset", message: "The stream restarted." },
      },
    };

    expect(readFanficVersion(extra)).toEqual({
      models: [WRITER, DRAFTER],
      origin: { kind: "revise", notes: "Snarkier.", baseVersion: 0 },
      unfinished: { reason: "provider_reset", code: "llm_stream_text_reset", message: "The stream restarted." },
    });
  });

  it("reads a version saved inside serialized extra", () => {
    const extra = JSON.stringify({ fanficVersion: { models: [WRITER], origin: { kind: "chapter", notes: "" } } });

    expect(readFanficVersion(extra)).toEqual({
      models: [WRITER],
      origin: { kind: "chapter", notes: "" },
      unfinished: null,
    });
  });

  it.each([
    ["no extra", undefined],
    ["extra without a version", { generationInfo: { model: "big-model" } }],
    ["a version that is not an object", { fanficVersion: "chapter" }],
    ["a version that is a list", { fanficVersion: [WRITER] }],
    ["unreadable serialized extra", "{ broken"],
  ])("treats %s as a chapter written before versions were recorded", (_label, extra) => {
    expect(readFanficVersion(extra)).toBeNull();
  });

  it("drops model records it can't read and keeps the rest in order", () => {
    const version = readFanficVersion({
      fanficVersion: {
        models: [
          WRITER,
          null,
          "Writer",
          { connectionId: "conn-c", name: 7, model: "x" },
          { connectionId: "conn-d", name: "", model: "" },
          { name: "No id", model: "m" },
          { connectionId: "conn-e", name: "", model: "local-model" },
          DRAFTER,
        ],
        origin: { kind: "chapter", notes: "" },
        unfinished: null,
      },
    });

    expect(version?.models).toEqual([WRITER, { connectionId: "conn-e", name: "", model: "local-model" }, DRAFTER]);
  });

  it("reads a version with no model list as having no models", () => {
    expect(readFanficVersion({ fanficVersion: { models: "Writer" } })?.models).toEqual([]);
  });

  it("falls back to a plain chapter origin when the stored origin can't be read", () => {
    expect(readFanficVersion({ fanficVersion: { models: [], origin: { kind: "sequel", notes: 3 } } })?.origin).toEqual({
      kind: "chapter",
      notes: "",
    });
    expect(
      readFanficVersion({
        fanficVersion: { models: [], origin: { kind: "extra", notes: "Beach day.", baseVersion: -1 } },
      })?.origin,
    ).toEqual({ kind: "extra", notes: "Beach day." });
  });

  it("keeps a version with an unknown interruption reason unfinished, as a failure", () => {
    const version = readFanficVersion({
      fanficVersion: { models: [WRITER], unfinished: { reason: "solar_flare", code: 42, message: "Cut off." } },
    });

    expect(version?.unfinished).toEqual({ reason: "failure", code: null, message: "Cut off." });
  });

  it("reads a missing or null unfinished state as finished", () => {
    expect(readFanficVersion({ fanficVersion: { models: [WRITER] } })?.unfinished).toBeNull();
    expect(readFanficVersion({ fanficVersion: { models: [WRITER], unfinished: null } })?.unfinished).toBeNull();
  });
});

describe("fanficModelLabel", () => {
  it("names one model by its connection name and model id", () => {
    expect(fanficModelLabel([WRITER])).toBe("Writer • big-model");
  });

  it("lists every model that wrote part of a chapter, in writing order", () => {
    expect(fanficModelLabel([WRITER, DRAFTER])).toBe("Writer • big-model → Drafter • small-model");
  });

  it("shows a model once for parts it wrote back to back", () => {
    expect(fanficModelLabel([WRITER, WRITER, DRAFTER, DRAFTER])).toBe("Writer • big-model → Drafter • small-model");
  });

  it("shows a model again when it picked up after another one", () => {
    expect(fanficModelLabel([WRITER, DRAFTER, WRITER])).toBe(
      "Writer • big-model → Drafter • small-model → Writer • big-model",
    );
  });

  it("treats the same connection on another model as a different run", () => {
    expect(fanficModelLabel([WRITER, { ...WRITER, model: "bigger-model" }])).toBe(
      "Writer • big-model → Writer • bigger-model",
    );
  });

  it("keeps the name recorded at write time, whatever the connection is called now", () => {
    // The label reads only the record; a renamed or deleted connection doesn't change it.
    expect(fanficModelLabel([{ connectionId: "deleted", name: "Old name", model: "big-model" }])).toBe(
      "Old name • big-model",
    );
  });

  it("names a model by whichever of name and model id was recorded", () => {
    expect(fanficModelLabel([{ connectionId: "conn-a", name: "Writer", model: "" }])).toBe("Writer");
    expect(fanficModelLabel([{ connectionId: "conn-e", name: "", model: "local-model" }])).toBe("local-model");
  });

  it("has no label when no model was recorded", () => {
    expect(fanficModelLabel([])).toBeNull();
  });
});
