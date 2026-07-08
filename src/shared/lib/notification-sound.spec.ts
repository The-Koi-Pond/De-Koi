import { afterEach, describe, expect, test, vi } from "vitest";
import { playNotificationPing } from "./notification-sound";

describe("notification sound playback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("plays the frog preset from the built-in frog croak audio file", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const audioSources: string[] = [];

    class AudioMock {
      preload = "";
      volume = 1;

      constructor(public readonly src: string) {
        audioSources.push(src);
      }

      play = play;
    }

    vi.stubGlobal("Audio", AudioMock);
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);

    playNotificationPing("frog");

    expect(audioSources).toEqual(["/sounds/frog-croak.mp3"]);
    expect(play).toHaveBeenCalledTimes(1);
  });
});