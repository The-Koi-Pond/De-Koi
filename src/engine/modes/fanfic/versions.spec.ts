import { describe, expect, it } from "vitest";

import type { FanficModelRecord } from "../../contracts/types/fanfic";
import {
  classifyFanficInterruption,
  fanficModelLabel,
  fanficModelsWith,
  fanficRewrittenVersion,
  readFanficVersion,
} from "./versions";

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

  it.each([
    ["an unknown kind", { kind: "sequel", notes: "" }],
    ["notes that are not text", { kind: "chapter", notes: 3 }],
    ["no origin", undefined],
  ])("reads %s as an unknown origin, not as a new chapter", (_label, origin) => {
    expect(readFanficVersion({ fanficVersion: { models: [], origin } })?.origin).toBeNull();
  });

  it("reads an extra chapter's origin and drops a base version it can't read", () => {
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

describe("fanficModelsWith", () => {
  it("adds a model that picks up after another one", () => {
    expect(fanficModelsWith([WRITER], DRAFTER)).toEqual([WRITER, DRAFTER]);
    expect(fanficModelsWith([WRITER, DRAFTER], WRITER)).toEqual([WRITER, DRAFTER, WRITER]);
  });

  it("doesn't add the model that wrote the last part again", () => {
    expect(fanficModelsWith([WRITER], { ...WRITER, name: "Renamed" })).toEqual([WRITER]);
  });

  it("adds the same connection on another model", () => {
    expect(fanficModelsWith([WRITER], { ...WRITER, model: "bigger-model" })).toEqual([
      WRITER,
      { ...WRITER, model: "bigger-model" },
    ]);
  });
});

describe("fanficRewrittenVersion", () => {
  const source = (models: FanficModelRecord[]) => ({
    activeSwipeIndex: 1,
    extra: { fanficVersion: { models, origin: { kind: "chapter", notes: "" }, unfinished: null } },
  });

  it("credits the rewriting model after the source version's models", () => {
    expect(fanficRewrittenVersion(source([WRITER]), DRAFTER, " Snarkier. ")).toEqual({
      models: [WRITER, DRAFTER],
      origin: { kind: "revise", notes: "Snarkier.", baseVersion: 1 },
      unfinished: null,
    });
  });

  it("credits a rewrite by the model that wrote the version once", () => {
    expect(fanficRewrittenVersion(source([DRAFTER, WRITER]), WRITER, "").models).toEqual([DRAFTER, WRITER]);
  });
});

describe("classifyFanficInterruption", () => {
  const failure = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields);

  it.each([
    ["a provider restart", failure("Restarted.", { code: "llm_stream_text_reset" }), "provider_reset"],
    [
      "a Claude subscription reply that was replaced",
      failure("Replaced.", { code: "claude_subscription_stream_replaced" }),
      "provider_reset",
    ],
    ...["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].map((finishReason) => [
      `a Gemini ${finishReason} block`,
      failure("Blocked.", { code: "llm_stream_incomplete", details: { code: "llm_stream_incomplete", finishReason } }),
      "content_filter",
    ]),
    [
      "an OpenAI Responses content filter",
      failure("Filtered.", {
        code: "llm_provider_error",
        details: { response: { incomplete_details: { reason: "content_filter" } } },
      }),
      "content_filter",
    ],
    ["a length stop", failure("Too long.", { code: "llm_stream_length" }), "length"],
    [
      "an OpenAI Responses output limit",
      failure("Cut.", {
        code: "llm_provider_error",
        details: { response: { incomplete_details: { reason: "max_output_tokens" } } },
      }),
      "length",
    ],
    [
      "a Gemini stream that ended without a finish reason",
      failure("Ended.", { code: "llm_stream_incomplete" }),
      "failure",
    ],
    ["a runtime timeout", failure("Timed out.", { details: { code: "remote_runtime_stream_timeout" } }), "failure"],
    ["an error without a code", new Error("Something broke."), "failure"],
  ] as Array<[string, Error, string]>)(
    "files %s under its reason with the error's code and message",
    (_label, error, reason) => {
      const parsed = error as Error & { code?: string; details?: { code?: string } };
      expect(classifyFanficInterruption(error, null)).toEqual({
        reason,
        code: parsed.code ?? parsed.details?.code ?? null,
        message: error.message,
      });
    },
  );

  it("files an error that is not an Error object as a failure", () => {
    expect(classifyFanficInterruption("offline", null)).toEqual({ reason: "failure", code: null, message: null });
  });

  it.each([
    [{ finishReason: "content_filter" }, "content_filter", "content_filter"],
    [{ stopReason: "refusal" }, "content_filter", "refusal"],
    [{ stopReason: "max_tokens" }, "length", "max_tokens"],
    [{ stopReason: "MAX_TOKENS" }, "length", "MAX_TOKENS"],
  ])("files a reply that ended with %o under %s", (providerMetadata, reason, code) => {
    expect(classifyFanficInterruption(null, providerMetadata)).toEqual({ reason, code, message: null });
  });

  it.each([
    ["no metadata", null],
    ["a normal stop", { finishReason: "stop", stopReason: "end_turn" }],
    ["a Gemini normal stop", { stopReason: "STOP" }],
  ])("reads a reply that ended with %s as finished", (_label, providerMetadata) => {
    expect(classifyFanficInterruption(null, providerMetadata)).toBeNull();
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
