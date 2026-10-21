import { afterEach, describe, expect, test, vi } from "vitest";
import { holdNotificationPingsQuiet, playNotificationPing } from "./notification-sound";

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

  test("stays silent while a quiet hold is active and plays again once every hold is released", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "Audio",
      class {
        preload = "";
        volume = 1;
        play = play;
      },
    );
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);

    const releaseCall = holdNotificationPingsQuiet();
    const releaseOther = holdNotificationPingsQuiet();
    playNotificationPing("frog");
    releaseCall();
    releaseCall(); // releasing twice must not end the other hold early
    playNotificationPing("frog");
    expect(play).not.toHaveBeenCalled();

    releaseOther();
    playNotificationPing("frog");
    expect(play).toHaveBeenCalledTimes(1);
  });
});
