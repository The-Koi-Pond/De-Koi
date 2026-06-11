import { makeManualTrackerRowId } from "../../../../engine/shared/game-state/tracker-row-ids";
import type { InventoryItem } from "../../../../engine/contracts/types/game-state";

export function normalizeInventoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function removeInventoryUnit<T extends { name: string; quantity: number }>(items: T[], itemName: string): T[] {
  const normalized = normalizeInventoryName(itemName).toLowerCase();
  if (!normalized) return items;

  let changed = false;
  const next: T[] = [];
  for (const item of items) {
    if (!changed && item.name.trim().toLowerCase() === normalized) {
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
  const normalized = normalizeInventoryName(itemName).toLowerCase();
  if (!normalized) return items;
  const next = items.filter((item) => item.name.trim().toLowerCase() !== normalized);
  return next.length === items.length ? items : next;
}

export function addInventoryUnit<T extends { name: string; quantity: number }>(items: T[], itemName: string): T[] {
  const name = normalizeInventoryName(itemName);
  if (!name) return items;
  const existingIndex = items.findIndex((item) => item.name.trim().toLowerCase() === name.toLowerCase());
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

  const targetItemId = inventoryItemId?.trim();
  if (targetItemId) {
    let addedToExisting = false;
    const updated = items.map((item) => {
      if (item.inventoryItemId !== targetItemId) return item;
      addedToExisting = true;
      return { ...item, quantity: item.quantity + 1 };
    });

    if (addedToExisting) return updated;
  }

  const normalizedName = name.toLowerCase();
  const matchingIndexes = items
    .map((item, index) => (item.name.trim().toLowerCase() === normalizedName ? index : -1))
    .filter((index) => index >= 0);

  if (matchingIndexes.length === 1) {
    const targetIndex = matchingIndexes[0]!;
    return items.map((item, index) => (index === targetIndex ? { ...item, quantity: item.quantity + 1 } : item));
  }

  return [
    ...items,
    {
      inventoryItemId: makeManualTrackerRowId(),
      name,
      description: "",
      quantity: 1,
      location: "on_person",
    },
  ];
}

export function renameInventoryItem<T extends { name: string; quantity: number }>(
  items: T[],
  currentName: string,
  nextName: string,
): { items: T[]; resolvedName: string } | null {
  const normalizedCurrentName = normalizeInventoryName(currentName).toLowerCase();
  const cleanedNextName = normalizeInventoryName(nextName);
  if (!normalizedCurrentName || !cleanedNextName) return null;

  const sourceIndex = items.findIndex((item) => item.name.trim().toLowerCase() === normalizedCurrentName);
  if (sourceIndex < 0) return null;

  const sourceItem = items[sourceIndex]!;
  if (normalizeInventoryName(sourceItem.name) === cleanedNextName) {
    return { items, resolvedName: sourceItem.name };
  }

  const normalizedNextName = cleanedNextName.toLowerCase();
  const mergeIndex = items.findIndex(
    (item, index) => index !== sourceIndex && normalizeInventoryName(item.name).toLowerCase() === normalizedNextName,
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
  const existingNames = new Set(items.map((item) => normalizeInventoryName(item.name).toLowerCase()));
  if (!existingNames.has(baseName.toLowerCase())) {
    return baseName;
  }

  let suffix = 2;
  while (existingNames.has(`${baseName} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}
