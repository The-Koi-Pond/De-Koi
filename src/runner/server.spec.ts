import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { JobRegistry } from "./jobs";
import { createRunnerServer } from "./server";

let server: http.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

describe("following a job's stream", () => {
  it("stops counting a screen as following once its connection drops", async () => {
    const registry = new JobRegistry();
    const job = registry.create("job-1", "chat-1", { chatId: "chat-1" });
    server = createRunnerServer(
      { runtimeUrl: "http://127.0.0.1:1/", addr: "127.0.0.1:0", basicAuth: null, trustedOrigins: new Set() },
      registry,
    );
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: `/runner/jobs/${job.id}/stream`,
      headers: { "content-type": "application/json", "x-marinara-csrf": "1" },
    });
    request.on("error", () => {});
    const firstEvent = new Promise<void>((resolve) =>
      request.on("response", (res) => res.once("data", () => resolve())),
    );
    request.end("{}");
    registry.push(job, { type: "token", data: "Snow." });
    await firstEvent;
    expect(registry.followers(job)).toBe(1);

    // The phone sleeps or the tab closes mid-write: its connection goes away while the job keeps running.
    request.destroy();
    for (let tries = 0; tries < 50 && registry.followers(job) > 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(registry.followers(job)).toBe(0);
    expect(job.status).toBe("running");
  });
});
