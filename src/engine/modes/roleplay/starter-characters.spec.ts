import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { lintCharacterCard } from "../../entities/character-card-lint";
import { ROLEPLAY_STARTER_CHARACTERS } from "./starter-characters";

describe("roleplay starter characters", () => {
  it("each has a unique id and everything a first scene needs", () => {
    const ids = ROLEPLAY_STARTER_CHARACTERS.map((starter) => starter.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const starter of ROLEPLAY_STARTER_CHARACTERS) {
      for (const field of ["name", "hook", "description", "personality", "scenario", "firstMessage"] as const) {
        expect(starter[field].trim(), `${starter.id}.${field}`).not.toBe("");
      }
    }
  });

  it("each greeting ends by asking the player something", () => {
    for (const starter of ROLEPLAY_STARTER_CHARACTERS) {
      const lastParagraph =
        starter.firstMessage
          .trim()
          .split(/\n\s*\n/)
          .at(-1) ?? "";
      expect(lastParagraph, starter.id).toContain("?");
    }
  });

  it("passes De-Koi's own card check", () => {
    for (const starter of ROLEPLAY_STARTER_CHARACTERS) {
      const findings = lintCharacterCard({
        name: starter.name,
        description: starter.description,
        personality: starter.personality,
        scenario: starter.scenario,
        first_mes: starter.firstMessage,
      });
      expect(findings, starter.id).toEqual([]);
    }
  });
});

describe("staged starters", () => {
  const backgroundsDir = resolve(process.cwd(), "src-tauri/resources/default-data/backgrounds");
  const builtInTags = JSON.parse(readFileSync(resolve(backgroundsDir, "meta.json"), "utf8")) as Record<string, unknown>;
  const staged = ROLEPLAY_STARTER_CHARACTERS.filter((starter) => starter.staging);

  it("at least one starter looks finished without an image connection", () => {
    expect(staged.length).toBeGreaterThan(0);
  });

  it("every bundled picture and scene background ships with the app", () => {
    for (const starter of staged) {
      const staging = starter.staging!;
      const files = [staging.avatar, ...Object.values(staging.sprites)];
      for (const file of files) {
        expect(existsSync(resolve(process.cwd(), "public", staging.folder, file)), `${starter.id}: ${file}`).toBe(true);
      }
      expect(staging.sprites.neutral, `${starter.id} needs a neutral sprite`).toBeTruthy();
      expect(staging.scenes.length).toBeGreaterThan(0);
      for (const scene of staging.scenes) {
        expect(existsSync(resolve(backgroundsDir, scene.background)), scene.background).toBe(true);
        expect(builtInTags[scene.background], `${scene.background} tags in meta.json`).toBeTruthy();
        expect(scene.keywords.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
