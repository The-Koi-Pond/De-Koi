import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import recordings from "../../test-fixtures/recorded-requests.json";
import {
  byPlaceholder,
  changeValue,
  click,
  getByRole,
  labelledField,
  mount,
  normalizedPath,
  pressKey,
  queryByRole,
  QuietIntersectionObserver,
  settle,
  type Mounted,
  type SentRequest,
} from "../../test-fixtures/screen-driver";
import { resetDatacatTagsForTests } from "../../lib/providers/datacat";
import { providerById } from "../../lib/providers";
import type { ProviderId } from "../../lib/providers/types";
import { BotBrowserView } from "./BotBrowserView";

const sent = vi.hoisted(() => [] as SentRequest[]);

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

/**
 * Small hand-made site replies. The ids that a detail step opens come from the recording itself (the first card the
 * old screen opened), so the screen's detail request can be compared with it.
 */
function reply(path: string): unknown {
  const local = path.replace(/^\/bot-browser\//, "");
  if (local === "pygmalion/session") return { active: false, hasToken: false };
  if (local === "chartavern/session") return { active: false };
  if (local.startsWith("chub/search")) {
    return {
      data: {
        nodes: [
          { fullPath: "pongoon/bittersweet-confession-8b169617e100", name: "Lantern Keeper", topics: ["Fantasy"] },
        ],
        cursor: "more",
      },
    };
  }
  if (local.startsWith("chub/character/"))
    return { data: { node: { definition: { personality: "Keeps lanterns." } } } };
  if (local === "janny/search") {
    return {
      results: [
        {
          hits: [{ id: "dab43148-c76c-43cf-a6f0-4b1022942b23", name: "Kiryu Kazuma", tagIds: [53] }],
          totalPages: 10,
          totalHits: 800,
        },
      ],
    };
  }
  if (local.startsWith("janny/character/")) return { character: { personality: "Calm." } };
  if (local.startsWith("chartavern/search"))
    return { hits: [{ path: "maker/tavern-host", name: "Host" }], totalPages: 5 };
  if (local.startsWith("pygmalion/search")) {
    return { characters: [{ id: "6b67ca81-f58e-4a16-bf29-5f36313f29b7", displayName: "Gardener" }], totalItems: "500" };
  }
  if (local.startsWith("pygmalion/character")) return { character: { personality: { persona: "Grows things." } } };
  if (local.startsWith("wyvern/search"))
    return { results: [{ id: "_zLfky34DNpf2xR8zxrzf1", name: "Ferry" }], total: 500 };
  if (local.startsWith("wyvern/character/")) return { name: "Ferry", description: "Rows boats." };
  if (local === "datacat/tags") return [{ id: 6, name: "fantasy", count: 10 }];
  if (local.startsWith("datacat/recent") || local.startsWith("datacat/fresh")) {
    const characters = [{ characterId: "75207e2c-972e-4c32-9e4c-3d6068b90c59", chatName: "Moth" }];
    return local.startsWith("datacat/fresh")
      ? { windows: { last24h: { characters } } }
      : { characters, totalCount: 800 };
  }
  if (local.startsWith("datacat/download/"))
    throw Object.assign(new Error("Not found"), { details: { code: "not_found" } });
  if (local.startsWith("datacat/character/")) return { character: { personality: "Flutters." } };
  if (local.includes("/avatar/")) return { base64: "", mimeType: "image/png" };
  throw new Error(`No hand-made reply for ${path}`);
}

vi.mock("../../../../../shared/api/bot-browser-command-api", () => {
  const prefixed = (path: string) => (path.startsWith("/bot-browser/") ? path : `/bot-browser/${path}`);
  return {
    botBrowserCommandApi: {
      get: async (path: string) => {
        sent.push({ command: "bot_browser_get", path: prefixed(path) });
        return reply(prefixed(path));
      },
      post: async (path: string, body?: unknown) => {
        sent.push({ command: "bot_browser_post", path: prefixed(path), body: body ?? null });
        return reply(prefixed(path));
      },
    },
  };
});

interface RecordedState {
  provider: string;
  sort: string;
  page: number;
  search: string;
  nsfw: boolean;
  ascending: boolean;
  minTokens: string;
  maxTokens: string;
  features: Record<string, boolean>;
  includeTags: string[];
  excludeTags: string[];
}

interface RecordedStep {
  step: string;
  note?: string;
  state: RecordedState;
  requests: SentRequest[];
}

const providers = recordings.providers as unknown as Record<string, RecordedStep[]>;

function comparable(requests: SentRequest[]) {
  return requests
    .filter((request) => !request.path.includes("/avatar/"))
    .map((request) => ({
      command: request.command,
      path: normalizedPath(request.path),
      ...(request.command === "bot_browser_post" ? { body: request.body ?? null } : {}),
    }));
}

async function openFilters() {
  if (queryByRole("region", "Filters") || document.querySelector("section[aria-label='Filters']")) return;
  await click(getByRole("button", /^Filters/));
}

async function openTags() {
  if (document.querySelector("aside[aria-label='Tags']")) return;
  await click(getByRole("button", /^Tags/));
}

/** Does in the screen what a user did to get from one recorded state to the next. */
async function drive(previous: RecordedState, next: RecordedState, step: RecordedStep) {
  if (step.step === "detail") {
    const firstTile = document.querySelector<HTMLButtonElement>("main ul > li > button");
    if (!firstTile) throw new Error("No card to open");
    await click(firstTile);
    return;
  }
  if (next.provider !== previous.provider) {
    const provider = providerById(next.provider as ProviderId);
    await click(getByRole("button", providerById(previous.provider as ProviderId).name));
    await click(getByRole("menuitemradio", provider.name));
    const continueButton = queryByRole("button", `Continue to ${provider.name}`);
    if (continueButton) await click(continueButton);
    return;
  }
  if (next.sort !== previous.sort) await changeValue(getByRole("combobox", "Sort") as HTMLSelectElement, next.sort);
  if (next.page !== previous.page) await click(getByRole("button", next.page > previous.page ? "Next" : "Previous"));
  if (next.nsfw !== previous.nsfw) await click(getByRole("switch"));

  const provider = providerById(next.provider as ProviderId);
  const featureKeys = new Set([...Object.keys(previous.features), ...Object.keys(next.features)]);
  for (const key of featureKeys) {
    if (Boolean(previous.features[key]) === Boolean(next.features[key])) continue;
    const label = [...provider.features, ...provider.toggles].find((item) => item.key === key)?.label;
    if (label) {
      await openFilters();
      await click(labelledField<HTMLInputElement>(label));
    }
    // A filter the provider doesn't offer (Wyvern's, decision 4) can't be clicked; the recording still searched.
    else await click(getByRole("button", "Refresh"));
  }
  if (next.ascending !== previous.ascending) {
    await openFilters();
    await changeValue(labelledField<HTMLSelectElement>("Sort direction"), next.ascending ? "asc" : "desc");
  }
  for (const field of ["minTokens", "maxTokens"] as const) {
    if (next[field] === previous[field]) continue;
    if (!provider.hasTokenFilters) {
      await click(getByRole("button", "Refresh"));
      continue;
    }
    await openFilters();
    await changeValue(
      labelledField<HTMLInputElement>(field === "minTokens" ? "Min tokens" : "Max tokens"),
      next[field],
    );
    await settle();
  }

  const tagsCleared =
    next.includeTags.length === 0 &&
    next.excludeTags.length === 0 &&
    previous.includeTags.length + previous.excludeTags.length > 0;
  if (tagsCleared) {
    await openTags();
    await click(getByRole("button", "Clear"));
  } else {
    for (const tag of next.includeTags.filter((item) => !previous.includeTags.includes(item))) {
      await openTags();
      const box = byPlaceholder("Search tags");
      await changeValue(box, tag);
      await pressKey(box, "Enter");
    }
    for (const tag of next.excludeTags.filter((item) => !previous.excludeTags.includes(item))) {
      await openTags();
      await changeValue(byPlaceholder("Search tags"), tag);
      await click(getByRole("button", `− Block ${tag} from results`));
    }
  }

  if (next.search !== previous.search) {
    if (next.search === "") await click(getByRole("button", "Clear search"));
    else {
      await changeValue(byPlaceholder("Search characters"), next.search);
      await settle(150);
    }
  }
}

describe("Bot Browser requests match the recordings", () => {
  let mounted: Mounted | null = null;

  beforeEach(() => {
    sent.length = 0;
    window.localStorage.clear();
    resetDatacatTagsForTests();
    vi.stubGlobal("IntersectionObserver", QuietIntersectionObserver);
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    vi.unstubAllGlobals();
  });

  for (const [providerId, steps] of Object.entries(providers)) {
    it(`sends ${providerId}'s recorded requests at every step`, async () => {
      let previous: RecordedState | null = null;
      for (const step of steps) {
        sent.length = 0;
        if (!previous) {
          mounted = await mount(<BotBrowserView />);
        } else {
          await drive(previous, step.state, step);
        }
        await settle();
        expect(comparable(sent), `${providerId} step "${step.step}"`).toEqual(comparable(step.requests));
        previous = step.state;
      }
    }, 20_000);
  }
});
