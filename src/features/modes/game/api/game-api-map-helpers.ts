import * as g from "./game-api-support";
import { generatedAssetSlug } from "./game-api-asset-helpers";

export function defaultGameMap(name = "Starting Area", description = "The party's current area."): g.GameMap {
  return {
    id: g.newId("map"),
    type: "grid",
    name,
    description,
    width: 3,
    height: 3,
    cells: [
      {
        x: 1,
        y: 1,
        emoji: "Start",
        label: "Start",
        discovered: true,
        terrain: "safe",
        description: "The party's starting point.",
      },
    ],
    partyPosition: { x: 1, y: 1 },
  } as g.GameMap;
}

export function setupMapFromResponse(setup: Record<string, unknown>): g.GameMap {
  const startingMap = g.asRecord(setup.startingMap);
  const regions = Array.isArray(startingMap.regions) ? startingMap.regions.map(g.asRecord) : [];
  if (regions.length === 0) {
    return defaultGameMap(
      typeof startingMap.name === "string" && startingMap.name.trim() ? startingMap.name : "Starting Area",
      typeof startingMap.description === "string" ? startingMap.description : "The party's current area.",
    );
  }

  const columns = Math.max(2, Math.ceil(Math.sqrt(regions.length)));
  const usedNodeIds = new Set<string>();
  const normalizedIdsByRawId = new Map<string, string[]>();
  const nodes = regions.map((region, index) => {
    const rawId = typeof region.id === "string" && region.id.trim() ? region.id.trim() : `region_${index + 1}`;
    const id = uniqueGeneratedNodeId(rawId, usedNodeIds);
    normalizedIdsByRawId.set(rawId, [...(normalizedIdsByRawId.get(rawId) ?? []), id]);
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id,
      emoji: typeof region.emoji === "string" && region.emoji.trim() ? region.emoji.trim() : "•",
      label: typeof region.name === "string" && region.name.trim() ? region.name.trim() : `Area ${index + 1}`,
      x: columns <= 1 ? 50 : 15 + (70 * column) / Math.max(1, columns - 1),
      y: 20 + row * 24,
      discovered: region.discovered !== false,
      description: typeof region.description === "string" ? region.description : "",
    };
  });
  const knownIds = new Set(nodes.map((node) => node.id));
  const edges = regions.flatMap((region, index) => {
    const from = nodes[index]!.id;
    const targets = Array.isArray(region.connectedTo) ? region.connectedTo : [];
    return targets
      .map(String)
      .map((to) => resolveGeneratedNodeReference(to, knownIds, normalizedIdsByRawId))
      .filter((to): to is string => !!to)
      .map((to) => ({ from, to }));
  });
  return {
    id: g.newId("map"),
    type: "node",
    name: typeof startingMap.name === "string" && startingMap.name.trim() ? startingMap.name.trim() : "Starting Area",
    description: typeof startingMap.description === "string" ? startingMap.description : "",
    nodes,
    edges,
    partyPosition: nodes[0]!.id,
  } as g.GameMap;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type GeneratedMapNodeNormalization = {
  rawId: string | null;
  node: NonNullable<g.GameMap["nodes"]>[number];
};

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(g.readNumber(value, fallback))));
}

function clampPercent(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(100, g.readNumber(value, fallback)));
}

function normalizeGeneratedGridCell(
  value: unknown,
  index: number,
  width: number,
  height: number,
): NonNullable<g.GameMap["cells"]>[number] | null {
  const record = g.asRecord(value);
  const x = clampInteger(record.x, index % width, 0, width - 1);
  const y = clampInteger(record.y, Math.floor(index / width), 0, height - 1);
  const label = readOptionalString(record, "label") ?? `Area ${index + 1}`;
  return {
    x,
    y,
    emoji: readOptionalString(record, "emoji") ?? "",
    label,
    discovered: record.discovered !== false,
    terrain: readOptionalString(record, "terrain") ?? "unknown",
    ...(readOptionalString(record, "description") ? { description: readOptionalString(record, "description")! } : {}),
  };
}

function uniqueGeneratedNodeId(rawId: string, usedIds: Set<string>): string {
  const base = rawId.trim() || "location";
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeGeneratedMapNode(
  value: unknown,
  index: number,
  usedIds: Set<string>,
): GeneratedMapNodeNormalization | null {
  const record = g.asRecord(value);
  const label = readOptionalString(record, "label") ?? readOptionalString(record, "name") ?? `Area ${index + 1}`;
  const rawId = readOptionalString(record, "id") ?? generatedAssetSlug(label);
  const id = uniqueGeneratedNodeId(rawId, usedIds);
  if (!id) return null;
  return {
    rawId,
    node: {
      id,
      emoji: readOptionalString(record, "emoji") ?? "",
      label,
      x: clampPercent(record.x, 50),
      y: clampPercent(record.y, 50),
      discovered: record.discovered !== false,
      ...(readOptionalString(record, "description") ? { description: readOptionalString(record, "description")! } : {}),
    },
  };
}

function resolveGeneratedNodeReference(
  rawId: string | null,
  knownNodeIds: Set<string>,
  normalizedIdsByRawId: Map<string, string[]>,
): string | null {
  if (!rawId) return null;
  if (knownNodeIds.has(rawId)) return rawId;
  return normalizedIdsByRawId.get(rawId)?.[0] ?? null;
}

function normalizeGeneratedMapEdge(
  value: unknown,
  knownNodeIds: Set<string>,
  normalizedIdsByRawId: Map<string, string[]>,
): NonNullable<g.GameMap["edges"]>[number] | null {
  const record = g.asRecord(value);
  const rawFrom = readOptionalString(record, "from");
  const rawTo = readOptionalString(record, "to");
  const duplicateAliases = rawFrom && rawFrom === rawTo ? normalizedIdsByRawId.get(rawFrom) : null;
  const from =
    duplicateAliases && duplicateAliases.length > 1
      ? duplicateAliases[0]!
      : resolveGeneratedNodeReference(rawFrom, knownNodeIds, normalizedIdsByRawId);
  const to =
    duplicateAliases && duplicateAliases.length > 1
      ? duplicateAliases[1]!
      : resolveGeneratedNodeReference(rawTo, knownNodeIds, normalizedIdsByRawId);
  if (!from || !to || from === to) return null;
  return {
    from,
    to,
    ...(readOptionalString(record, "label") ? { label: readOptionalString(record, "label")! } : {}),
  };
}

function normalizeGridPartyPosition(
  value: unknown,
  fallback: { x: number; y: number },
  width: number,
  height: number,
  knownCoordinates: Set<string>,
): { x: number; y: number } {
  const record = g.asRecord(value);
  const candidate = {
    x: clampInteger(record.x, fallback.x, 0, width - 1),
    y: clampInteger(record.y, fallback.y, 0, height - 1),
  };
  return knownCoordinates.has(`${candidate.x},${candidate.y}`) ? candidate : fallback;
}

function isGameMap(value: unknown): value is g.GameMap {
  const record = g.asRecord(value);
  return record.type === "grid" || record.type === "node";
}

export function mapForMovement(meta: Record<string, unknown>, mapId?: string | null): g.GameMap {
  const maps = Array.isArray(meta.gameMaps) ? (meta.gameMaps as g.GameMap[]) : [];
  const current = isGameMap(meta.gameMap) ? (meta.gameMap as g.GameMap) : null;
  const requestedMapId = g.readTrimmed(mapId);
  if (requestedMapId) {
    const requested =
      maps.find((map) => map.id === requestedMapId) ?? (current?.id === requestedMapId ? current : null);
    if (!requested) throw new Error("Map was not found.");
    return requested;
  }
  const activeGameMapId = g.readTrimmed(meta.activeGameMapId);
  if (activeGameMapId) {
    const active = maps.find((map) => map.id === activeGameMapId) ?? (current?.id === activeGameMapId ? current : null);
    if (active) return active;
  }
  return current ?? maps.find(isGameMap) ?? defaultGameMap();
}

function validateMapPartyPosition(
  map: g.GameMap,
  position: { x: number; y: number } | string,
): g.GameMap["partyPosition"] {
  if (map.type === "grid") {
    if (!position || typeof position !== "object" || Array.isArray(position)) {
      throw new Error("Map movement requires grid coordinates.");
    }
    if (!Number.isInteger(position.x) || !Number.isInteger(position.y)) {
      throw new Error("Map movement requires integer grid coordinates.");
    }
    const cells = Array.isArray(map.cells) ? map.cells : [];
    if (cells.length === 0) throw new Error("Map movement map has no known cells.");
    if (!cells.some((cell) => cell.x === position.x && cell.y === position.y)) {
      throw new Error("Map movement target is not a known grid cell.");
    }
    return { x: position.x, y: position.y };
  }
  const nodeId = typeof position === "string" ? position.trim() : "";
  if (!nodeId) throw new Error("Map movement requires a node id.");
  const nodes = Array.isArray(map.nodes) ? map.nodes : [];
  if (nodes.length === 0) throw new Error("Map movement map has no known nodes.");
  if (!nodes.some((node) => node.id === nodeId)) {
    throw new Error("Map movement target is not a known map node.");
  }
  return nodeId;
}

export function moveMapPartyPosition(map: g.GameMap, position: { x: number; y: number } | string): g.GameMap {
  const partyPosition = validateMapPartyPosition(map, position);
  if (map.type === "grid" && typeof partyPosition !== "string") {
    return {
      ...map,
      partyPosition,
      cells: (map.cells ?? []).map((cell) =>
        cell.x === partyPosition.x && cell.y === partyPosition.y ? { ...cell, discovered: true } : cell,
      ),
    };
  }
  if (map.type === "node" && typeof partyPosition === "string") {
    return {
      ...map,
      partyPosition,
      nodes: (map.nodes ?? []).map((node) => (node.id === partyPosition ? { ...node, discovered: true } : node)),
    };
  }
  return { ...map, partyPosition } as g.GameMap;
}

export function normalizeGeneratedMap(raw: unknown, fallback: g.GameMap): g.GameMap | null {
  const record = g.asRecord(raw);
  const type = record.type === "grid" || record.type === "node" ? record.type : null;
  if (!type) return null;
  const name = readOptionalString(record, "name") ?? fallback.name;
  const base = {
    id: readOptionalString(record, "id") ?? generatedAssetSlug(name),
    type,
    name,
    description: readOptionalString(record, "description") ?? fallback.description,
  };
  if (type === "grid") {
    const width = clampInteger(record.width, fallback.width ?? 6, 1, 12);
    const height = clampInteger(record.height, fallback.height ?? 6, 1, 12);
    const cellByCoordinate = new Map<string, NonNullable<g.GameMap["cells"]>[number]>();
    if (Array.isArray(record.cells)) {
      record.cells.slice(0, width * height).forEach((cell, index) => {
        const normalizedCell = normalizeGeneratedGridCell(cell, index, width, height);
        if (!normalizedCell) return;
        const key = `${normalizedCell.x},${normalizedCell.y}`;
        if (!cellByCoordinate.has(key)) cellByCoordinate.set(key, normalizedCell);
      });
    }
    const cells = [...cellByCoordinate.values()];
    if (cells.length === 0) return null;
    const fallbackCell = cells.find((cell) => cell.discovered) ?? cells[0]!;
    const fallbackPosition = { x: fallbackCell.x, y: fallbackCell.y };
    const knownCoordinates = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
    const partyPosition = normalizeGridPartyPosition(
      record.partyPosition,
      fallbackPosition,
      width,
      height,
      knownCoordinates,
    );
    return {
      ...base,
      type: "grid",
      width,
      height,
      cells: cells.map((cell) =>
        cell.x === partyPosition.x && cell.y === partyPosition.y ? { ...cell, discovered: true } : cell,
      ),
      partyPosition,
    };
  }
  const usedNodeIds = new Set<string>();
  const nodeEntries = Array.isArray(record.nodes)
    ? record.nodes
        .slice(0, 80)
        .map((node, index) => normalizeGeneratedMapNode(node, index, usedNodeIds))
        .filter((entry): entry is GeneratedMapNodeNormalization => !!entry)
    : [];
  const nodes = nodeEntries.map((entry) => entry.node);
  if (nodes.length === 0) return null;
  const knownNodeIds = new Set(nodes.map((node) => node.id));
  const normalizedIdsByRawId = new Map<string, string[]>();
  for (const entry of nodeEntries) {
    if (!entry.rawId) continue;
    normalizedIdsByRawId.set(entry.rawId, [...(normalizedIdsByRawId.get(entry.rawId) ?? []), entry.node.id]);
  }
  const edges = Array.isArray(record.edges)
    ? record.edges
        .slice(0, 160)
        .map((edge) => normalizeGeneratedMapEdge(edge, knownNodeIds, normalizedIdsByRawId))
        .filter((edge): edge is NonNullable<g.GameMap["edges"]>[number] => !!edge)
    : [];
  const partyPosition =
    typeof record.partyPosition === "string" && knownNodeIds.has(record.partyPosition.trim())
      ? record.partyPosition.trim()
      : nodes[0]!.id;
  return {
    ...base,
    type: "node",
    nodes,
    edges,
    partyPosition,
  };
}

export function gameMapJsonRepairContext(data: {
  chatId: string;
  locationType: string;
  context: string;
  connectionId?: string | null;
}): g.GameJsonRepairContext {
  return {
    kind: "game_map",
    title: "Repair Game Map JSON",
    applyBody: {
      chatId: data.chatId,
      locationType: data.locationType,
      context: data.context,
      connectionId: data.connectionId,
    },
  };
}

export function mapJsonCouldNotApplyError(
  generated: Record<string, unknown>,
  data: { chatId: string; locationType: string; context: string; connectionId?: string | null },
): g.ApiError {
  const repair = gameMapJsonRepairContext(data);
  return new g.ApiError("The model returned map JSON that needs review before it can be applied.", 422, {
    jsonRepair: {
      kind: repair.kind,
      title: repair.title,
      rawJson: JSON.stringify(generated, null, 2),
      applyEndpoint: `local://game/${repair.kind}`,
      applyBody: repair.applyBody,
    },
  });
}
