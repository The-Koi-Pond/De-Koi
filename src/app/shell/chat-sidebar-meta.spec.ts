import { describe, expect, it } from "vitest";

import { chatRowCharacterNames, formatChatLastActive } from "./chat-sidebar-meta";

const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime();

describe("formatChatLastActive", () => {
  it("counts minutes, hours and days for the last week", () => {
    expect(formatChatLastActive(NOW - 20_000, NOW)).toBe("just now");
    expect(formatChatLastActive(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatChatLastActive(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe("2h ago");
    expect(formatChatLastActive(NOW - 3 * 86_400_000, NOW)).toBe("3d ago");
  });

  it("shows a slightly future time as just now and a bad one as nothing", () => {
    expect(formatChatLastActive(NOW + 90_000, NOW)).toBe("just now");
    expect(formatChatLastActive("not a date", NOW)).toBe("");
  });

  it("names the year only for another year", () => {
    expect(formatChatLastActive(new Date(2026, 2, 4), NOW)).not.toBe("");
    expect(formatChatLastActive(new Date(2026, 2, 4), NOW)).not.toContain("2026");
    expect(formatChatLastActive(new Date(2025, 2, 4), NOW)).toContain("2025");
  });
});

describe("chatRowCharacterNames", () => {
  it("skips characters the chat's name already mentions", () => {
    expect(chatRowCharacterNames("Coffee with Mira", ["Mira", "Jun"])).toBe("Jun");
    expect(chatRowCharacterNames("Mira and Jun", ["mira", "JUN"])).toBe("");
  });

  it("matches whole names only, in any script", () => {
    expect(chatRowCharacterNames("Annual party", ["Ann"])).toBe("Ann");
    expect(chatRowCharacterNames("Ann's party", ["ann"])).toBe("");
    expect(chatRowCharacterNames("Tea with Zoë", ["zoë", "Zo"])).toBe("Zo");
    expect(chatRowCharacterNames("Tea (R2) time", ["(R2)", "Dr. K"])).toBe("Dr. K");
  });

  it("names two and counts the rest", () => {
    expect(chatRowCharacterNames("Camp", ["Ana", "Bo", "Cy", "Di"])).toBe("Ana, Bo +2");
    expect(chatRowCharacterNames("Camp", ["", " "])).toBe("");
  });
});
