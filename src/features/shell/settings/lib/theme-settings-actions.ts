import type { Theme } from "../../../../engine/contracts/types/theme";

export type ThemeImportDraft = {
  name: string;
  css: string;
};

export function buildThemeSaveInput(name: string, css: string, now: () => Date = () => new Date()) {
  return {
    name: name.trim() || "Untitled Theme",
    css,
    installedAt: now().toISOString(),
  };
}

export function parseThemeImportText(fileName: string, text: string): ThemeImportDraft {
  if (fileName.endsWith(".json")) {
    const parsed = JSON.parse(text) as { name?: unknown; css?: unknown };
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : fileName.replace(/\.json$/, ""),
      css: typeof parsed.css === "string" ? parsed.css : "",
    };
  }

  return {
    name: fileName.replace(/\.css$/, ""),
    css: text,
  };
}

export function findImportedThemeDuplicate(themes: Theme[], draft: ThemeImportDraft) {
  return themes.find((theme) => theme.name === draft.name && theme.css === draft.css) ?? null;
}
