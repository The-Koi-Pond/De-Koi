export const presetKeys = {
  all: ["presets"] as const,
  list: () => [...presetKeys.all, "list"] as const,
  presence: () => [...presetKeys.all, "presence"] as const,
  full: (id: string) => [...presetKeys.all, "full", id] as const,
  sections: (presetId: string) => [...presetKeys.all, "sections", presetId] as const,
  groups: (presetId: string) => [...presetKeys.all, "groups", presetId] as const,
  choiceBlocks: (presetId: string) => [...presetKeys.all, "choices", presetId] as const,
  default: () => [...presetKeys.all, "default"] as const,
  defaultSummary: () => [...presetKeys.default(), "summary"] as const,
};
