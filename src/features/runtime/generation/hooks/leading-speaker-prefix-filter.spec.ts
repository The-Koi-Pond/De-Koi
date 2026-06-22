import { describe, expect, it } from "vitest";
import { createLeadingSpeakerPrefixFilter, filterLeadingSpeakerPrefix } from "./leading-speaker-prefix-filter";

describe("createLeadingSpeakerPrefixFilter", () => {
  it("strips case-insensitive speaker prefixes across chunks", () => {
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

  it("filters a full replacement payload", () => {
    expect(filterLeadingSpeakerPrefix("alice: Hello there.", ["Alice"])).toBe("Hello there.");
  });

  it("can discard a pending partial prefix before replacement", () => {
    const filter = createLeadingSpeakerPrefixFilter(["Alice"]);

    expect(filter.filter("Ali")).toBe("");
    filter.reset();

    expect(filter.filter("Hello")).toBe("Hello");
    expect(filter.flush()).toBe("");
  });
});
