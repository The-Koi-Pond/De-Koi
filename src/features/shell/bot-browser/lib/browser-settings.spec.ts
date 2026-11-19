// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { BROWSER_SETTINGS_KEY, readBrowserSettings, saveLogin, saveProviderNsfw } from "./browser-settings";

function stored() {
  return JSON.parse(window.localStorage.getItem(BROWSER_SETTINGS_KEY) ?? "null");
}

describe("saved browser settings", () => {
  beforeEach(() => window.localStorage.clear());

  it("loads an existing marinara-bot-browser value", () => {
    window.localStorage.setItem(
      BROWSER_SETTINGS_KEY,
      JSON.stringify({ nsfw: { chub: true, janny: false }, logins: { pygmalion: true }, lastSource: "chub" }),
    );
    expect(readBrowserSettings()).toEqual({ nsfw: { chub: true, janny: false }, logins: { pygmalion: true } });
  });

  it("writes changes in the same shape and keeps every other key", () => {
    window.localStorage.setItem(
      BROWSER_SETTINGS_KEY,
      JSON.stringify({ nsfw: { chub: true }, logins: {}, lastSource: "janny", somethingElse: [1] }),
    );
    saveProviderNsfw("janny", true);
    saveLogin("chartavern", true, true);
    expect(stored()).toEqual({
      nsfw: { chub: true, janny: true, chartavern: true },
      logins: { chartavern: true },
      lastSource: "janny",
      somethingElse: [1],
    });
    saveLogin("chartavern", false, false);
    expect(stored()).toMatchObject({ nsfw: { chartavern: false }, logins: { chartavern: false } });
  });

  it("treats a missing or wrongly shaped part as empty (decision 5)", () => {
    for (const value of ["null", "42", '"text"', "{not json", JSON.stringify({ nsfw: null, logins: "x" }), "[]"]) {
      window.localStorage.setItem(BROWSER_SETTINGS_KEY, value);
      expect(readBrowserSettings(), value).toEqual({ nsfw: {}, logins: {} });
    }
    window.localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify({ nsfw: { chub: "yes", janny: true } }));
    expect(readBrowserSettings()).toEqual({ nsfw: { janny: true }, logins: {} });

    window.localStorage.setItem(BROWSER_SETTINGS_KEY, "{not json");
    saveProviderNsfw("chub", true);
    expect(stored()).toEqual({ nsfw: { chub: true }, logins: {} });
  });

  it("starts empty when nothing is saved", () => {
    expect(readBrowserSettings()).toEqual({ nsfw: {}, logins: {} });
  });
});
