import { describe, expect, it } from "vitest";
import type { GameMap } from "../../../contracts/types/game";
import { applyMapUpdateCommandsToMeta, parseMapUpdateCommands } from "./map-position.service";

function townMap(): GameMap {
  return {
    id: "town",
    type: "node",
    name: "Town",
    description: "",
    nodes: [{ id: "square", label: "Town Square", emoji: "S", x: 50, y: 50, discovered: true }],
    edges: [],
    partyPosition: "square",
  };
}

describe("game map update commands", () => {
  it("creates and activates a separate indoor map when map_name is provided", () => {
    const meta = {
      gameMap: townMap(),
      gameMaps: [townMap()],
      activeGameMapId: "town",
    };
    const commands = parseMapUpdateCommands(
      '[map_update: map_name="Old Library" new_location="Reading Room" connected_to="Entrance" node_emoji="book"]',
    );

    const next = applyMapUpdateCommandsToMeta(meta, commands);
    const maps = next.gameMaps as GameMap[];

    expect(next.activeGameMapId).toBe("old-library");
    expect(maps.map((map) => map.name)).toEqual(["Town", "Old Library"]);
    expect((next.gameMap as GameMap).nodes?.map((node) => node.label)).toEqual(["Reading Room"]);
    expect((maps[0] as GameMap).nodes?.map((node) => node.label)).toEqual(["Town Square"]);
  });
});
