import { describe, expect, it } from "vitest";
import { shouldShowConversationLocalNotification } from "./local-notifications";

describe("conversation local notification guard", () => {
  it("requires explicit opt-in and granted notification permission", () => {
    expect(
      shouldShowConversationLocalNotification({
        enabled: false,
        permission: "granted",
        appFocused: false,
      }),
    ).toBe(false);
    expect(
      shouldShowConversationLocalNotification({
        enabled: true,
        permission: "default",
        appFocused: false,
      }),
    ).toBe(false);
  });

  it("suppresses notifications while Marinara is focused", () => {
    expect(
      shouldShowConversationLocalNotification({
        enabled: true,
        permission: "granted",
        appFocused: true,
      }),
    ).toBe(false);
  });

  it("allows a generic notification when opted in, granted, and unfocused", () => {
    expect(
      shouldShowConversationLocalNotification({
        enabled: true,
        permission: "granted",
        appFocused: false,
      }),
    ).toBe(true);
  });
});
