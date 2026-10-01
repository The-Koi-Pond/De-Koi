import { describe, expect, it } from "vitest";
import type { DekiEntryAction } from "../../../../engine/deki/deki-entry";
import { createDekiActionDiffRows, createDekiRowChangeDiffRows } from "./deki-action-diff";
import { dekiDiffFieldLabel, orderDekiDiffRowsForReading, presentDekiDiffRow } from "./deki-diff-presentation";

function editRows(patch: Record<string, unknown>, current: Record<string, unknown>) {
  const action: DekiEntryAction = { type: "edit_record", entity: "characters", id: "char-1", patch };
  return createDekiActionDiffRows(action, current);
}

describe("presentDekiDiffRow", () => {
  it("shows short values as before -> after", () => {
    const [row] = editRows({ data: { name: "Sol" } }, { data: { name: "Sun" } });

    expect(presentDekiDiffRow(row!)).toEqual({ kind: "scalar", before: "Sun", after: "Sol" });
  });

  it("shows tags as added and removed chips", () => {
    const [row] = editRows({ data: { tags: ["fantasy", "koi"] } }, { data: { tags: ["fantasy", "pond"] } });

    expect(presentDekiDiffRow(row!)).toEqual({ kind: "list", added: ["koi"], removed: ["pond"], kept: ["fantasy"] });
  });

  it("shows booleans and enum-like fields as state pills", () => {
    const [toggle] = createDekiRowChangeDiffRows({
      entity: "lorebook-entries",
      id: "e1",
      action: "update",
      before: { enabled: false },
      after: { enabled: true },
    });
    const [role] = createDekiRowChangeDiffRows({
      entity: "lorebook-entries",
      id: "e1",
      action: "update",
      before: { role: "system" },
      after: { role: "assistant" },
    });

    expect(presentDekiDiffRow(toggle!)).toEqual({ kind: "state", before: "Off", after: "On" });
    expect(presentDekiDiffRow(role!)).toEqual({ kind: "state", before: "system", after: "assistant" });
  });

  it("shows colors with their values for swatches", () => {
    const [row] = createDekiRowChangeDiffRows({
      entity: "personas",
      id: "p1",
      action: "update",
      before: { nameColor: "#334455" },
      after: { nameColor: "rgb(240, 138, 82)" },
    });

    expect(presentDekiDiffRow(row!)).toEqual({ kind: "color", before: "#334455", after: "rgb(240, 138, 82)" });
  });

  it("keeps prose as an inline diff and collapses long text", () => {
    const short = editRows({ data: { scenario: "A quiet\nshop." } }, { data: { scenario: "A busy\nshop." } })[0]!;
    const long = editRows({ data: { description: "x".repeat(500) } }, { data: { description: "y".repeat(500) } })[0]!;

    expect(presentDekiDiffRow(short)).toMatchObject({ kind: "prose", collapsible: false });
    expect(presentDekiDiffRow(long)).toMatchObject({ kind: "prose", collapsible: true });
  });

  it("treats long list items as prose instead of chips", () => {
    const [row] = editRows({ data: { alternate_greetings: ["g".repeat(120)] } }, { data: { alternate_greetings: [] } });

    expect(presentDekiDiffRow(row!).kind).toBe("prose");
  });
});

describe("dekiDiffFieldLabel", () => {
  it("uses card vocabulary for character fields", () => {
    expect(dekiDiffFieldLabel("data.first_mes")).toBe("First message");
    expect(dekiDiffFieldLabel("data.extensions.backstory")).toBe("Backstory");
    expect(dekiDiffFieldLabel("keys")).toBe("Activation keys");
    expect(dekiDiffFieldLabel("data.scenario")).toBe("Scenario");
    expect(dekiDiffFieldLabel("entries.0.content", "Koi")).toBe("Koi");
  });
});

describe("lorebook redraft rows", () => {
  it("heads each entry with its name and marks existing-lorebook redrafts as proposed", () => {
    const action: DekiEntryAction = {
      type: "apply_lorebook_redraft",
      id: "book-pond",
      lorebook: { name: "Pond Notes", description: "Lore for the pond." },
      entries: [{ name: "Koi", content: "Koi circle the lantern." }, { content: "Unnamed lore." }],
    };

    const rows = createDekiActionDiffRows(action);

    expect(rows.map((row) => dekiDiffFieldLabel(row.path, row.label))).toEqual([
      "Name",
      "Description",
      "Koi",
      "Entry 2",
    ]);
    expect(rows.every((row) => row.statusLabel === "proposed")).toBe(true);
    expect(createDekiActionDiffRows({ ...action, id: undefined }).every((row) => !row.statusLabel)).toBe(true);
  });
});

describe("orderDekiDiffRowsForReading", () => {
  it("puts short facts and tags before long prose, keeping order within each group", () => {
    const rows = editRows(
      { data: { first_mes: "A long\nopening.", name: "Sol", tags: ["koi"], scenario: "Short scene." } },
      { data: { first_mes: "Hi.", name: "Sun", tags: [], scenario: "Old scene." } },
    );

    expect(orderDekiDiffRowsForReading(rows).map((row) => row.path)).toEqual([
      "data.name",
      "data.scenario",
      "data.tags",
      "data.first_mes",
    ]);
  });
});
