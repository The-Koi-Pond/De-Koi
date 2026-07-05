import { describe, expect, it } from "vitest";
import { createLeadingSpeakerPrefixFilter, filterLeadingSpeakerPrefix } from "./leading-speaker-prefix-filter";

describe("leading speaker-prefix stream boundary filtering", () => {
  it("strips case-insensitive speaker prefixes split across stream chunks", () => {
    const filter = createLeadingSpeakerPrefixFilter(["Alice"]);

    expect(filter.filter("ali")).toBe("");
    expect(filter.filter("ce: ")).toBe("");
    expect(filter.filter("Hello there.")).toBe("Hello there.");
    expect(filter.flush()).toBe("");
  });

  it("does not flush a confirmed prefix back into the stream", () => {
    const filter = createLeadingSpeakerPrefixFilter(["Alice"]);

    expect(filter.filter("Alice: ")).toBe("");
    expect(filter.flush()).toBe("");
  });

  it("flushes an unconfirmed partial speaker name", () => {
    const filter = createLeadingSpeakerPrefixFilter(["Alice"]);

    expect(filter.filter("Ali")).toBe("");
    expect(filter.flush()).toBe("Ali");
  });

  it("strips complete internal speaker tags split across stream chunks", () => {
    const filter = createLeadingSpeakerPrefixFilter(["Alice"]);

    expect(filter.filter('<speaker name="Alice">Hel')).toBe("Hel");
    expect(filter.filter("lo</spe")).toBe("lo");
    expect(filter.filter("aker>")).toBe("");
    expect(filter.flush()).toBe("");
  });

  it("buffers incomplete internal speaker tag fragments without holding visible text", () => {
    const filter = createLeadingSpeakerPrefixFilter(["Alice"]);

    expect(filter.filter("Hello <spe")).toBe("Hello ");
    expect(filter.filter('aker name="Alice">there')).toBe("there");
    expect(filter.flush()).toBe("");
  });

  it("filters a full replacement payload from replacement-style streams", () => {
    expect(filterLeadingSpeakerPrefix("alice: Hello there.", ["Alice"])).toBe("Hello there.");
  });

  it("can discard a pending partial stream prefix before replacement", () => {
    const filter = createLeadingSpeakerPrefixFilter(["Alice"]);

    expect(filter.filter("Ali")).toBe("");
    filter.reset();

    expect(filter.filter("Hello")).toBe("Hello");
    expect(filter.flush()).toBe("");
  });
});
