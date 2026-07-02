export type YouTubeIframeCommand = "playVideo" | "pauseVideo" | "stopVideo" | "setVolume";

export function sendYouTubeIframeCommand(
  frame: HTMLIFrameElement | null,
  func: YouTubeIframeCommand,
  args: unknown[] = [],
): boolean {
  const contentWindow = frame?.contentWindow;
  if (!contentWindow) return false;
  contentWindow.postMessage(
    JSON.stringify({
      event: "command",
      func,
      args,
    }),
    "https://www.youtube.com",
  );
  return true;
}
