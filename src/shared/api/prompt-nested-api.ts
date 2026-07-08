import { invokeTauri } from "./tauri-client";

export type PromptNestedReorderKind = "groups" | "sections" | "variables";

export const promptNestedApi = {
  reorder: <T>(input: { presetId: string; kind: PromptNestedReorderKind; ids: string[] }) =>
    invokeTauri<T[]>("prompt_nested_reorder", {
      presetId: input.presetId,
      kind: input.kind,
      orderedIds: input.ids,
    }),
};