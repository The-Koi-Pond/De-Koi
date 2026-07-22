import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isPerformanceDiagnosticsEnabled,
  markPerformanceMilestone,
  markPerformanceMilestoneOnce,
  measurePerformanceAsync,
  reportPerformanceStageTiming,
} from "./performance-diagnostics";

describe("performance diagnostics", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("stays silent by default", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const mark = vi.spyOn(performance, "mark").mockImplementation(() => undefined as unknown as PerformanceMark);

    expect(isPerformanceDiagnosticsEnabled()).toBe(false);

    markPerformanceMilestone("app.boot");
    await expect(measurePerformanceAsync({ category: "ipc", name: "storage_list" }, async () => "ok")).resolves.toBe(
      "ok",
    );

    expect(info).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
  });

  it("keeps opt-in stage timings silent by default", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    reportPerformanceStageTiming({
      name: "generation.prompt_assembly",
      elapsedMs: 12,
      status: "ok",
      metadata: { messageCount: 3 },
    });

    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("redacts non-count stage details before logging", () => {
    window.localStorage.setItem("deKoiPerformanceDiagnostics", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    reportPerformanceStageTiming({
      name: "generation.prompt_assembly",
      elapsedMs: 12.345,
      status: "ok",
      metadata: {
        messageCount: 3,
        prompt: 99,
        request: 55,
        secret: 10,
        promptMessageCount: Number.POSITIVE_INFINITY,
      } as never,
    });

    expect(info).toHaveBeenCalledWith("[de-koi:perf] span", {
      category: "generation",
      name: "generation.prompt_assembly",
      status: "ok",
      elapsedMs: 12.35,
      messageCount: 3,
    });
  });

  it("allows only the sanitized Lorebook Keeper timing count", () => {
    window.localStorage.setItem("deKoiPerformanceDiagnostics", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    reportPerformanceStageTiming({
      name: "generation.lorebook_keeper_backfill",
      elapsedMs: 8.5,
      status: "error",
      metadata: { runCount: 1 },
    });

    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[de-koi:perf] span", {
      category: "generation",
      name: "generation.lorebook_keeper_backfill",
      status: "error",
      elapsedMs: 8.5,
      runCount: 1,
    });
  });

  it("emits opt-in milestones and successful async spans without argument payloads", async () => {
    window.localStorage.setItem("deKoiPerformanceDiagnostics", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const mark = vi.spyOn(performance, "mark").mockImplementation(() => undefined as unknown as PerformanceMark);
    vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(37);

    markPerformanceMilestone("shell.ready", { route: "conversation" });
    const result = await measurePerformanceAsync(
      {
        category: "ipc",
        name: "storage_list",
        details: { runtime: "embedded", collection: "chats", args: { secret: "redacted" } },
      },
      async () => "loaded",
    );

    expect(result).toBe("loaded");
    expect(mark).toHaveBeenCalledWith("de-koi:shell.ready");
    expect(info).toHaveBeenCalledWith("[de-koi:perf] mark", {
      name: "shell.ready",
      route: "conversation",
    });
    expect(info).toHaveBeenCalledWith("[de-koi:perf] span", {
      category: "ipc",
      name: "storage_list",
      status: "ok",
      elapsedMs: 27,
      runtime: "embedded",
      collection: "chats",
    });
  });

  it("emits opt-in failed async spans before rethrowing", async () => {
    window.localStorage.setItem("deKoiPerformanceDiagnostics", "true");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValueOnce(50).mockReturnValueOnce(75);
    const error = new Error("boom");

    await expect(
      measurePerformanceAsync({ category: "remote", name: "storage_get" }, async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(warn).toHaveBeenCalledWith("[de-koi:perf] span", {
      category: "remote",
      name: "storage_get",
      status: "error",
      elapsedMs: 25,
      errorName: "Error",
      errorMessage: "boom",
    });
  });

  it("emits one-shot milestones only once per page session", () => {
    window.localStorage.setItem("deKoiPerformanceDiagnostics", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const mark = vi.spyOn(performance, "mark").mockImplementation(() => undefined as unknown as PerformanceMark);

    markPerformanceMilestoneOnce("chat.summary-list.ready", { rowCount: 2 });
    markPerformanceMilestoneOnce("chat.summary-list.ready", { rowCount: 3 });

    expect(mark).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[de-koi:perf] mark", {
      name: "chat.summary-list.ready",
      rowCount: 2,
    });
  });
});
