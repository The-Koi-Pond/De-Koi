import { describe, expect, it } from "vitest";

import type { GenerationContextAttribution } from "../../../../../engine/contracts/types/chat";
import { buildPromptAttributionViewModel } from "./prompt-attribution";

describe("prompt attribution view model", () => {
  it("labels saved attribution snapshots as exact context evidence", () => {
    const attribution: GenerationContextAttribution = {
      source: "saved_snapshot",
      items: [
        {
          kind: "memory_recall",
          label: "Memory 1",
          status: "injected",
          snippet: "Celia promised to meet Deki at the koi pond.",
        },
      ],
    };

    expect(buildPromptAttributionViewModel(attribution)).toEqual({
      sourceLabel: "Saved attribution",
      sourceTone: "exact",
      groups: [
        {
          label: "Memory",
          items: [
            expect.objectContaining({
              label: "Memory 1",
              statusLabel: "Injected",
              snippet: "Celia promised to meet Deki at the koi pond.",
            }),
          ],
        },
      ],
    });
  });

  it("groups chat history and summary sources with continuity labels", () => {
    const attribution: GenerationContextAttribution = {
      source: "saved_snapshot",
      items: [
        {
          kind: "chat_history",
          label: "Celia",
          status: "injected",
          snippet: "Remember the moon gate password.",
        },
        {
          kind: "chat_summary",
          label: "Chat Summary",
          status: "injected",
          snippet: "Celia and Deki agreed to meet at the koi pond.",
        },
      ],
    };

    expect(buildPromptAttributionViewModel(attribution)?.groups).toEqual([
      {
        label: "Recent Chat",
        items: [
          expect.objectContaining({
            label: "Celia",
            statusLabel: "Injected",
            snippet: "Remember the moon gate password.",
          }),
        ],
      },
      {
        label: "Chat Summary",
        items: [
          expect.objectContaining({
            label: "Chat Summary",
            statusLabel: "Injected",
            snippet: "Celia and Deki agreed to meet at the koi pond.",
          }),
        ],
      },
    ]);
  });

  it("labels selected and skipped authored examples as Behavioral Examples", () => {
    const attribution: GenerationContextAttribution = {
      source: "saved_snapshot",
      items: [
        {
          kind: "behavioral_example",
          label: "Mira · mes example",
          status: "injected",
          snippet: "Mira refuses to surrender the key.",
        },
        {
          kind: "behavioral_example",
          label: "Mira · alternate greeting",
          status: "skipped",
          snippet: "Mira comments on the weather.",
        },
      ],
    };

    expect(buildPromptAttributionViewModel(attribution)?.groups).toEqual([
      {
        label: "Behavioral Examples",
        items: [
          expect.objectContaining({ statusLabel: "Injected" }),
          expect.objectContaining({ statusLabel: "Skipped" }),
        ],
      },
    ]);
  });

  it("keeps redacted hidden sources out of snippets", () => {
    const attribution: GenerationContextAttribution = {
      source: "best_effort_reconstruction",
      items: [
        {
          kind: "agent_injection",
          label: "Secret Plot",
          status: "redacted",
          snippet: "should not show",
          metadata: { redacted: true },
        },
      ],
    };

    const model = buildPromptAttributionViewModel(attribution);

    expect(model).not.toBeNull();
    expect(model!.sourceLabel).toBe("Best-effort attribution");
    expect(model!.sourceTone).toBe("best_effort");
    expect(model!.groups[0]?.items[0]).toEqual(
      expect.objectContaining({
        label: "Secret Plot",
        statusLabel: "Redacted",
        snippet: null,
      }),
    );
  });
});
