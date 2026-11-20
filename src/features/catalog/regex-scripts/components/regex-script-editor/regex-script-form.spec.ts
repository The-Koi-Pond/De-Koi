import { describe, expect, it } from "vitest";
import type { RegexScriptRow } from "../../hooks/use-regex-scripts";
import { liveTestResult, regexPatternError } from "./live-test";
import {
  depthFromInput,
  newRegexScriptForm,
  orderFromInput,
  regexScriptFormFromRow,
  regexScriptFormProblem,
  regexScriptSavePayload,
  toggleRegexFlag,
  toggleRegexPlacement,
} from "./regex-script-form";

const ROW: RegexScriptRow = {
  id: "rx",
  name: "Row",
  enabled: "1",
  findRegex: "a",
  replaceString: "b",
  trimStrings: ["x"],
  placement: ["user_input", "prompt", "ai_output"],
  flags: "gimsuyd",
  promptOnly: "true",
  order: 4,
  minDepth: 1,
  maxDepth: null,
  characterId: " char-b ",
  targetCharacterIds: [],
  createdAt: "",
  updatedAt: "",
};

describe("regex script form", () => {
  it("reads a stored row the way the spec's loading table says", () => {
    expect(regexScriptFormFromRow(ROW)).toEqual({
      name: "Row",
      enabled: true,
      findRegex: "a",
      replaceString: "b",
      trimStrings: ["x"],
      placement: ["user_input", "ai_output"],
      targetCharacterIds: ["char-b"],
      flags: "gimsuyd",
      applyMode: "prompt",
      order: 4,
      minDepth: 1,
      maxDepth: null,
    });
    expect(
      regexScriptFormFromRow({ ...ROW, trimStrings: "x" as never, placement: "ai_output" as never }),
    ).toMatchObject({ trimStrings: [], placement: [] });
  });

  it("sends the payload fields in the contract's order", () => {
    const form = {
      ...newRegexScriptForm(),
      findRegex: "x",
      targetCharacterIds: ["b", "a"],
      applyMode: "prompt" as const,
    };
    const payload = regexScriptSavePayload(form);
    expect(Object.keys(payload)).toEqual([
      "name",
      "enabled",
      "findRegex",
      "replaceString",
      "trimStrings",
      "placement",
      "flags",
      "promptOnly",
      "applyMode",
      "order",
      "minDepth",
      "maxDepth",
      "characterId",
      "targetCharacterIds",
    ]);
    expect(payload).toMatchObject({ promptOnly: true, characterId: "b", targetCharacterIds: ["b", "a"] });
    expect(regexScriptSavePayload(newRegexScriptForm())).toMatchObject({ promptOnly: false, characterId: null });
  });

  it("toggles flags, places and number inputs like the old editor", () => {
    expect(toggleRegexFlag("gimsuyd", "g")).toBe("imsuyd");
    expect(toggleRegexFlag("imsuyd", "g")).toBe("imsuydg");
    expect(toggleRegexFlag("gg", "g")).toBe("g");
    expect(toggleRegexPlacement(["ai_output"], "ai_output")).toEqual(["ai_output"]);
    expect(toggleRegexPlacement(["ai_output"], "user_input")).toEqual(["ai_output", "user_input"]);
    expect(toggleRegexPlacement(["ai_output", "user_input"], "ai_output")).toEqual(["user_input"]);
    expect([orderFromInput(""), orderFromInput("1.5"), orderFromInput("-3")]).toEqual([0, 1, -3]);
    expect([depthFromInput(""), depthFromInput("3.9"), depthFromInput("0")]).toEqual([null, 3, 0]);
  });

  it("names the first problem the storage schema would reject", () => {
    const valid = { ...newRegexScriptForm(), findRegex: "a" };
    expect(regexScriptFormProblem(valid)).toBeNull();
    expect(regexScriptFormProblem({ ...valid, name: "", findRegex: "", placement: [] })).toBe(
      "Give the script a name.",
    );
    expect(regexScriptFormProblem({ ...valid, name: "n".repeat(201) })).toBe(
      "Keep the name to 200 characters or fewer.",
    );
    expect(regexScriptFormProblem({ ...valid, name: "n".repeat(200) })).toBeNull();
    expect(regexScriptFormProblem({ ...valid, name: " " })).toBeNull();
    expect(regexScriptFormProblem({ ...valid, findRegex: "" })).toBe("Add a find pattern.");
    expect(regexScriptFormProblem({ ...valid, placement: [] })).toBe(
      "Pick where it applies: AI Output, User Input or both.",
    );
  });
});

describe("live test", () => {
  it("reports the browser's message for a pattern that doesn't compile", () => {
    expect(regexPatternError("", "gi", "")).toBeNull();
    expect(regexPatternError("(", "gi", "")).toBe("Invalid regular expression: /(/gi: Unterminated group");
    expect(regexPatternError("{{user}}", "gi", "")).toBeNull();
  });

  it("applies the script with sample macro values and leaves the text alone when it can't run", () => {
    const base = { replaceString: "[{{char}}]", flags: "g", trimStrings: [], patternError: null };
    expect(liveTestResult({ ...base, liveText: "User and User", findRegex: "{{user}}" })).toBe(
      "[Character] and [Character]",
    );
    expect(liveTestResult({ ...base, liveText: "keep", findRegex: "" })).toBe("keep");
    expect(liveTestResult({ ...base, liveText: "keep", findRegex: "(", patternError: "bad" })).toBe("keep");
  });
});
