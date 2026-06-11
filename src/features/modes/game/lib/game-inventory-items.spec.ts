import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../../../../engine/contracts/types/game-state";
import {
  addDetailedInventoryUnit,
  addInventoryUnit,
  removeDetailedInventoryUnit,
  removeInventoryUnit,
} from "./game-inventory-items";

describe("game inventory item helpers", () => {
  it("uses collapsed whitespace identity for compact inventory stacks", () => {
    const inventory = addInventoryUnit([{ name: "Iron   Key", quantity: 1 }], "Iron Key");

    expect(inventory).toEqual([{ name: "Iron   Key", quantity: 2 }]);
    expect(removeInventoryUnit(inventory, "Iron Key")).toEqual([{ name: "Iron   Key", quantity: 1 }]);
  });

  it("adds compact metadata rows separately from detailed player inventory rows", () => {
    const compactInventory = addInventoryUnit([], "  Silver   Coin ");
    const detailedInventory = addDetailedInventoryUnit([], "  Silver   Coin ");

    expect(compactInventory).toEqual([{ name: "Silver Coin", quantity: 1 }]);
    expect(detailedInventory).toMatchObject([
      {
        name: "Silver Coin",
        description: "",
        quantity: 1,
        location: "on_person",
      },
    ]);
    expect(detailedInventory[0]?.inventoryItemId).toMatch(/^manual-/);
  });

  it("keeps detailed rows valid when incrementing and removing malformed existing rows", () => {
    const malformedInventory = [{ name: "Iron   Key", quantity: 2 }] as InventoryItem[];

    const incremented = addDetailedInventoryUnit(malformedInventory, "Iron Key");
    expect(incremented).toMatchObject([
      {
        name: "Iron Key",
        description: "",
        quantity: 3,
        location: "on_person",
      },
    ]);
    expect(incremented[0]?.inventoryItemId).toMatch(/^manual-/);

    const decremented = removeDetailedInventoryUnit(malformedInventory, "Iron Key");
    expect(decremented).toMatchObject([
      {
        name: "Iron Key",
        description: "",
        quantity: 1,
        location: "on_person",
      },
    ]);
    expect(decremented[0]?.inventoryItemId).toMatch(/^manual-/);
  });
});
