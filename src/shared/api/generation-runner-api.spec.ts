// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { generationRunnerApi } from "./generation-runner-api";
import { useUIStore } from "../stores/ui.store";

function sse(lines: string[]): Response {
  return new Response(lines.map((line) => `data: ${line}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("generationRunnerApi.follow", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useUIStore.setState({ remoteRuntimeUrl: "" });
  });

  it("keeps following a reply after the server is briefly unreachable", async () => {
    vi.useFakeTimers();
    useUIStore.setState({ remoteRuntimeUrl: "http://runtime.test" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(sse(['{"type":"token","data":"Hi"}', '{"type":"runner_end"}']));
    vi.stubGlobal("fetch", fetchMock);

    const events: unknown[] = [];
    const following = (async () => {
      for await (const event of generationRunnerApi.follow("job-1")) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(1_000);
    await following;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ type: "token", data: "Hi" }]);
  });
});
