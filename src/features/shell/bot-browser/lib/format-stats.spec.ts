import { describe, expect, it } from "vitest";

import { shortNumber, totalPages } from "./format-stats";

describe("short numbers", () => {
  it("rounds before choosing the unit (fix 8)", () => {
    expect(shortNumber(950)).toBe("950");
    expect(shortNumber(999.4)).toBe("999");
    expect(shortNumber(999.5)).toBe("1K");
    expect(shortNumber(1234)).toBe("1.2K");
    expect(shortNumber(999_949)).toBe("999.9K");
    expect(shortNumber(999_999)).toBe("1M");
    expect(shortNumber(3_400_000)).toBe("3.4M");
  });

  it("counts pages, at least one", () => {
    expect(totalPages(0, 48)).toBe(1);
    expect(totalPages(97, 48)).toBe(3);
  });
});
