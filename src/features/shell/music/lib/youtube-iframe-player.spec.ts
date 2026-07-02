import { describe, expect, it, vi } from "vitest";

import { sendYouTubeIframeCommand } from "./youtube-iframe-player";

describe("YouTube iframe player", () => {
  it("sends volume changes to the embedded player", () => {
    const postMessage = vi.fn();
    const frame = {
      contentWindow: { postMessage },
    } as unknown as HTMLIFrameElement;

    sendYouTubeIframeCommand(frame, "setVolume", [37]);

    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        event: "command",
        func: "setVolume",
        args: [37],
      }),
      "https://www.youtube.com",
    );
  });
});
