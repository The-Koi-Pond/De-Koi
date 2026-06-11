import { makeManualTrackerRowId } from "../../../../engine/shared/game-state/tracker-row-ids";
import type { InventoryItem } from "../../../../engine/contracts/types/game-state";

export function normalizeInventoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function inventoryNameKey(value: string): string {
  return normalizeInventoryName(value).toLowerCase();
}

function normalizeDetailedInventoryItem(item: InventoryItem): InventoryItem {
  const partial = item as Partial<InventoryItem>;
  const name = normalizeInventoryName(partial.name ?? "") || "Item";
  const quantity =
    typeof partial.quantity === "number" && Number.isFinite(partial.quantity) ? partial.quantity : 1;
  return {
    inventoryItemId: partial.inventoryItemId?.trim() || makeManualTrackerRowId(),
    name,
    description: partial.description?.trim() ?? "",
    quantity,
    location: partial.location?.trim() || "on_person",
  };
}

export function removeInventoryUnit<T extends { name: string; quantity: number }>(items: T[], itemName: string): T[] {
  const normalized = inventoryNameKey(itemName);
  if (!normalized) return items;

  let changed = false;
  const next: T[] = [];
  for (const item of items) {
    if (!changed && inventoryNameKey(item.name) === normalized) {
      changed = true;
      if (item.quantity > 1) {
        next.push({ ...item, quantity: item.quantity - 1 });
      }
      continue;
    }
    next.push(item);
  }
  return changed ? next : items;
}

export function removeInventoryStack<T extends { name: string; quantity: number }>(items: T[], itemName: string): T[] {
  const normalized = inventoryNameKey(itemName);
  if (!normalized) return items;
  const next = items.filter((item) => inventoryNameKey(item.name) !== normalized);
  return next.length === items.length ? items : next;
}

export function addInventoryUnit<T extends { name: string; quantity: number }>(items: T[], itemName: string): T[] {
  const name = normalizeInventoryName(itemName);
  if (!name) return items;
  const key = inventoryNameKey(name);
  const existingIndex = items.findIndex((item) => inventoryNameKey(item.name) === key);
  if (existingIndex >= 0) {
    return items.map((item, index) => (index === existingIndex ? { ...item, quantity: item.quantity + 1 } : item));
  }
  return [...items, { name, quantity: 1 } as T];
}

export function addDetailedInventoryUnit(
  items: InventoryItem[],
  itemName: string,
  inventoryItemId?: string,
): InventoryItem[] {
  const name = normalizeInventoryName(itemName);
  if (!name) return items;

  const normalizedItems = items.map(normalizeDetailedInventoryItem);
  const targetItemId = inventoryItemId?.trim();
  if (targetItemId) {
    let addedToExisting = false;
    const updated = normalizedItems.map((item) => {
      if (item.inventoryItemId !== targetItemId) return item;
      addedToExisting = true;
      return { ...item, quantity: item.quantity + 1 };
    });

    if (addedToExisting) return updated;
  }

  const normalizedName = inventoryNameKey(name);
  const matchingIndexes = normalizedItems
    .map((item, index) => (inventoryNameKey(item.name) === normalizedName ? index : -1))
    .filter((index) => index >= 0);

  if (matchingIndexes.length === 1) {
    const targetIndex = matchingIndexes[0]!;
    return normalizedItems.map((item, index) =>
      index === targetIndex ? { ...item, quantity: item.quantity + 1 } : item,
    );
  }

  return [
    ...normalizedItems,
    {
      inventoryItemId: makeManualTrackerRowId(),
      name,
      description: "",
      quantity: 1,
      location: "on_person",
    },
  ];
}

export function removeDetailedInventoryUnit(items: InventoryItem[], itemName: string): InventoryItem[] {
  const normalized = inventoryNameKey(itemName);
  if (!normalized) return items;

  let changed = false;
  const next: InventoryItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = normalizeDetailedInventoryItem(items[index]!);
    if (!changed && inventoryNameKey(item.name) === normalized) {
      changed = true;
      if (item.quantity > 1) {
        next.push({ ...item, quantity: item.quantity - 1 });
      }
      continue;
    }
    next.push(item);
  }
  return changed ? next : items;
}

export function renameInventoryItem<T extends { name: string; quantity: number }>(
  items: T[],
  currentName: string,
  nextName: string,
): { items: T[]; resolvedName: string } | null {
  const normalizedCurrentName = inventoryNameKey(currentName);
  const cleanedNextName = normalizeInventoryName(nextName);
  if (!normalizedCurrentName || !cleanedNextName) return null;

  const sourceIndex = items.findIndex((item) => inventoryNameKey(item.name) === normalizedCurrentName);
  if (sourceIndex < 0) return null;

  const sourceItem = items[sourceIndex]!;
  if (inventoryNameKey(sourceItem.name) === inventoryNameKey(cleanedNextName)) {
    return {
      items: items.map((item, index) => (index === sourceIndex ? { ...item, name: cleanedNextName } : item)),
      resolvedName: cleanedNextName,
    };
  }

  const normalizedNextName = inventoryNameKey(cleanedNextName);
  const mergeIndex = items.findIndex(
    (item, index) => index !== sourceIndex && inventoryNameKey(item.name) === normalizedNextName,
  );

  if (mergeIndex === -1) {
    return {
      items: items.map((item, index) => (index === sourceIndex ? { ...item, name: cleanedNextName } : item)),
      resolvedName: cleanedNextName,
    };
  }

  const mergeTarget = items[mergeIndex]!;
  const mergeTargetRecord = mergeTarget as T & Record<string, unknown>;
  const sourceRecord = sourceItem as T & Record<string, unknown>;
  const sourceDescription = typeof sourceRecord.description === "string" ? sourceRecord.description.trim() : "";
  const targetDescription =
    typeof mergeTargetRecord.description === "string" ? mergeTargetRecord.description.trim() : "";
  const sourceLocation = typeof sourceRecord.location === "string" ? sourceRecord.location.trim() : "";
  const targetLocation = typeof mergeTargetRecord.location === "string" ? mergeTargetRecord.location.trim() : "";
  const mergedItem = {
    ...mergeTarget,
    quantity: mergeTarget.quantity + sourceItem.quantity,
    ...(!targetDescription && sourceDescription ? { description: sourceDescription } : {}),
    ...(!targetLocation && sourceLocation ? { location: sourceLocation } : {}),
  } as T;

  return {
    items: items.flatMap((item, index) => {
      if (index === sourceIndex) return [];
      if (index === mergeIndex) return [mergedItem as T];
      return [item];
    }),
    resolvedName: normalizeInventoryName(mergeTarget.name) || cleanedNextName,
  };
}

export function getNextInventoryItemName(items: Array<{ name: string }>): string {
  const baseName = "New item";
  const existingNames = new Set(items.map((item) => inventoryNameKey(item.name)));
  if (!existingNames.has(inventoryNameKey(baseName))) {
    return baseName;
  }

  let suffix = 2;
  while (existingNames.has(inventoryNameKey(`${baseName} ${suffix}`))) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}
