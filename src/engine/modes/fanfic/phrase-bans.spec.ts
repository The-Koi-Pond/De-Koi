import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../../capabilities/llm";
import { LOCAL_SIDECAR_CONNECTION_ID } from "../../contracts/types/sidecar";
import {
  completeWithFanficPhraseBans,
  fanficConnectionSupportsPhraseBans,
  fanficPhraseOpeningBias,
  findFanficBannedPhrases,
  normalizeFanficBannedPhrases,
  repairFanficBannedPhrases,
} from "./phrase-bans";

const phrases = ["a mix of", "couldn't help but", "something shifted"];
const request = {
  connectionId: "local",
  messages: [{ role: "user" as const, content: "Write." }],
  maxTokens: 200,
  temperature: 0.9,
};

/** Replies by what the call asks: a full draft, a biased resample, or a continuation of the prefill. */
function localModel(script: (request: LlmRequest) => string) {
  const requests: LlmRequest[] = [];
  const llm = {
    complete: vi.fn(async (llmRequest: LlmRequest) => {
      requests.push(llmRequest);
      return script(llmRequest);
    }),
  } as unknown as LlmGateway;
  return { llm, requests };
}

describe("finding banned phrases", () => {
  it("matches whole words, any case, straight or curly apostrophes", () => {
    const text = "She couldn’t help but laugh. A Mix of nerves. Mixing of colors. Something shifted.";
    expect(findFanficBannedPhrases(text, phrases).map((hit) => hit.match)).toEqual([
      "couldn’t help but",
      "A Mix of",
      "Something shifted",
    ]);
    expect(findFanficBannedPhrases("The amix of it", phrases)).toEqual([]);
  });

  it("cleans the list and knows which connections can do it", () => {
    expect(normalizeFanficBannedPhrases(["  A Mix  of ", "a mix of", "", "!!!", "Couldn’t help"])).toEqual([
      "a mix of",
      "couldn't help",
    ]);
    expect(fanficConnectionSupportsPhraseBans({ id: LOCAL_SIDECAR_CONNECTION_ID })).toBe(true);
    expect(fanficConnectionSupportsPhraseBans({ provider: "custom", baseUrl: "http://127.0.0.1:8080/v1" })).toBe(true);
    expect(fanficConnectionSupportsPhraseBans({ provider: "custom", baseUrl: "http://localhost:5001/v1" })).toBe(true);
    expect(fanficConnectionSupportsPhraseBans({ provider: "custom", baseUrl: "https://api.example.com/v1" })).toBe(
      false,
    );
    expect(fanficConnectionSupportsPhraseBans({ provider: "openai", baseUrl: "http://127.0.0.1:8080/v1" })).toBe(false);
    expect(fanficPhraseOpeningBias("Couldn’t help but")).toMatchObject({ "Couldn’t": -100, " couldn't": -100 });
  });
});

describe("completeWithFanficPhraseBans", () => {
  it("backs up to a banned phrase, resamples there with its opening banned, and carries on", async () => {
    const { llm, requests } = localModel((call) => {
      const prefill = call.parameters?.assistantPrefill as string | undefined;
      if (!prefill) return "He stood there, a mix of nerves and hope. Then she smiled.";
      // A llama.cpp server returns the prefix along with the continuation.
      if (call.parameters?.customParameters) return `${prefill}all nerves`;
      return `${prefill} and hope. Then she smiled.`;
    });

    const result = await completeWithFanficPhraseBans(llm, request, phrases);

    expect(result).toMatchObject({
      text: "He stood there, all nerves and hope. Then she smiled.",
      backtracks: 1,
      remaining: [],
    });
    const resample = requests[1]!.parameters!;
    expect(resample.assistantPrefill).toBe("He stood there, ");
    expect(resample.maxTokens).toBe(8);
    expect((resample.customParameters as { logit_bias: Record<string, number> }).logit_bias).toMatchObject({
      " a": -100,
      a: -100,
    });
    expect(requests[2]!.parameters!.assistantPrefill).toBe("He stood there, all nerves");
    expect(requests[2]!.parameters!.customParameters).toBeUndefined();
  });

  it("stops after its budget when the model keeps landing on the phrase", async () => {
    const { llm } = localModel((call) => {
      const prefill = (call.parameters?.assistantPrefill as string | undefined) ?? "";
      return `${prefill}a mix of everything.`;
    });
    const result = await completeWithFanficPhraseBans(llm, request, phrases, { maxBacktracks: 2 });
    expect(result.backtracks).toBe(2);
    expect(result.remaining.length).toBeGreaterThan(0);
  });
});

describe("repairFanficBannedPhrases", () => {
  it("changes only the sentence that held the phrase and keeps the rest word for word", async () => {
    const text = "The tent was dark. She couldn't help but laugh at him. He scowled. The show went on.";
    const { llm, requests } = localModel((call) => {
      const prefill = call.parameters?.assistantPrefill as string;
      if (call.parameters?.customParameters) return `${prefill}laughed`;
      return `${prefill} at him before she could stop herself. And more words the repair throws away.`;
    });

    const result = await repairFanficBannedPhrases(llm, request, text, phrases);

    expect(result.text).toBe(
      "The tent was dark. She laughed at him before she could stop herself. He scowled. The show went on.",
    );
    expect(result).toMatchObject({ repaired: 1, remaining: [] });
    expect(requests[0]!.parameters!.assistantPrefill).toBe("The tent was dark. She ");
  });

  it("leaves a sentence alone when the resample keeps the phrase", async () => {
    const text = "The rain came. She couldn't help but laugh. He left.";
    const { llm } = localModel((call) => `${call.parameters?.assistantPrefill as string}couldn't help but grin.`);
    const result = await repairFanficBannedPhrases(llm, request, text, phrases);
    expect(result.text).toBe(text);
    expect(result.repaired).toBe(0);
    expect(result.remaining.map((hit) => hit.phrase)).toEqual(["couldn't help but"]);
  });
});
