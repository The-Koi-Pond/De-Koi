import { describe, expect, it } from "vitest";
import { FULL_DATA_ERASE_PHRASE, canEraseAllDeKoiData } from "./privacy-data-controls";

describe("privacy data controls", () => {
  it("enables the complete wipe only for the exact confirmation phrase", () => {
    expect(canEraseAllDeKoiData(FULL_DATA_ERASE_PHRASE)).toBe(true);
    expect(canEraseAllDeKoiData("Yes, erase all my de-koi data")).toBe(false);
    expect(canEraseAllDeKoiData(`${FULL_DATA_ERASE_PHRASE} `)).toBe(false);
    expect(canEraseAllDeKoiData("erase all my de-koi data")).toBe(false);
  });
});
