import { describe, expect, it, vi } from "vitest";
import { personaKeys } from "../query-keys";
import { invalidatePersonaCollectionQueries } from "./use-personas";

describe("persona collection invalidation", () => {
  it("refreshes minimal library presence after create and delete mutations", () => {
    const queryClient = { invalidateQueries: vi.fn() };

    invalidatePersonaCollectionQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: personaKeys.presence, exact: true });
  });
});
