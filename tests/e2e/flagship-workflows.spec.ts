import { expect, test } from "@playwright/test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

type JsonRecord = Record<string, unknown>;

const connection = {
  id: "connection-e2e",
  name: "Deterministic Test Model",
  provider: "openai",
  model: "deterministic-e2e",
};
const character = {
  id: "character-e2e",
  name: "E2E Koi",
  avatarPath: null,
  data: {
    name: "E2E Koi",
    description: "A deterministic test character.",
    personality: "Helpful and concise.",
    first_mes: "",
  },
};

const records = new Map<string, JsonRecord[]>();
let nextId = 1;
let streamCount = 0;
let failChatCreation = false;

function resetRuntime() {
  records.clear();
  records.set("connections", [{ ...connection }]);
  records.set("characters", [{ ...character }]);
  records.set("personas", []);
  records.set("chats", []);
  records.set("messages", []);
  nextId = 1;
  streamCount = 0;
  failChatCreation = false;
}

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function readBody(request: IncomingMessage): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as JsonRecord);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function collection(name: string): JsonRecord[] {
  const existing = records.get(name);
  if (existing) return existing;
  const created: JsonRecord[] = [];
  records.set(name, created);
  return created;
}

function invoke(command: string, args: JsonRecord): { status?: number; value: unknown } {
  if (command === "storage_list") {
    return { value: collection(String(args.entity ?? "")) };
  }
  if (command === "storage_get") {
    return {
      value: collection(String(args.entity ?? "")).find((item) => item.id === args.id) ?? null,
    };
  }
  if (command === "storage_create") {
    const entity = String(args.entity ?? "");
    if (entity === "chats" && failChatCreation) {
      return { status: 503, value: { code: "e2e_create_rejected", message: "Test runtime rejected chat creation." } };
    }
    const value = (args.value && typeof args.value === "object" ? args.value : {}) as JsonRecord;
    const now = new Date().toISOString();
    const record = {
      ...value,
      id: typeof value.id === "string" && value.id ? value.id : `${entity}-e2e-${nextId++}`,
      createdAt: value.createdAt ?? now,
      updatedAt: now,
    };
    collection(entity).push(record);
    return { value: record };
  }
  if (command === "storage_update") {
    const items = collection(String(args.entity ?? ""));
    const index = items.findIndex((item) => item.id === args.id);
    const patch = (args.patch && typeof args.patch === "object" ? args.patch : {}) as JsonRecord;
    if (index < 0) return { status: 404, value: { message: "Record not found" } };
    items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
    return { value: items[index] };
  }
  if (command === "storage_delete") {
    const items = collection(String(args.entity ?? ""));
    const index = items.findIndex((item) => item.id === args.id);
    if (index >= 0) items.splice(index, 1);
    return { value: { deleted: index >= 0 } };
  }
  if (command === "chat_message_add_swipe") {
    const message = collection("messages").find((item) => item.id === args.messageId);
    const body = (args.body && typeof args.body === "object" ? args.body : {}) as JsonRecord;
    if (message && typeof body.content === "string") {
      const swipes = Array.isArray(message.swipes) ? [...message.swipes] : [];
      swipes.push({ ...body, content: body.content });
      message.content = body.content;
      message.swipes = swipes;
      message.swipeIndex = swipes.length - 1;
    }
    return { value: message ?? {} };
  }
  if (command === "llm_list_models") {
    return { value: [{ id: connection.model, name: connection.model, provider: connection.provider }] };
  }
  if (command === "memory_index_query" || command === "memory_query") {
    return { value: [] };
  }
  if (command === "local_sidecar_status") {
    return { status: 404, value: { message: "Local sidecar is not available in the browser harness." } };
  }
  return { status: 501, value: { message: `Unhandled browser-harness command: ${command}` } };
}

function runtimeServer() {
  return createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Marinara-CSRF");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.url?.startsWith("/health")) {
      json(response, { ok: true, runtime: "de-koi-server", writable: true });
      return;
    }
    if (request.url === "/api/invoke" && request.method === "POST") {
      const body = await readBody(request);
      const result = invoke(String(body.command ?? ""), (body.args ?? {}) as JsonRecord);
      json(response, result.value, result.status ?? 200);
      return;
    }
    if (request.url === "/api/llm/stream" && request.method === "POST") {
      await readBody(request);
      streamCount += 1;
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write(`data: ${JSON.stringify({ type: "start" })}\n\n`);
      response.write(
        `data: ${JSON.stringify({ type: "token", text: `Deterministic streamed reply ${streamCount}` })}\n\n`,
      );
      response.end(`data: ${JSON.stringify({ type: "done", finishReason: "stop" })}\n\n`);
      return;
    }
    if (request.url?.includes("/api/llm/stream/") && request.url.endsWith("/cancel")) {
      json(response, { cancelled: true });
      return;
    }
    json(response, { message: "Not found" }, 404);
  });
}

let server: ReturnType<typeof runtimeServer>;
let runtimeUrl: string;

test.beforeAll(async () => {
  server = runtimeServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  runtimeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
});

test.beforeEach(async ({ page }) => {
  resetRuntime();
  await page.addInitScript(
    ({ url }) => {
      localStorage.setItem(
        "marinara-engine-ui-tauri",
        JSON.stringify({
          state: {
            remoteRuntimeUrl: url,
            hasCompletedOnboarding: true,
            enableStreaming: true,
            guideGenerations: false,
          },
          version: 11,
        }),
      );
    },
    { url: runtimeUrl },
  );
});

async function createConversation(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start Conversation chat" }).click();
  await expect(page.getByRole("heading", { name: "New Conversation" })).toBeVisible();
  await page.getByText("E2E Koi", { exact: true }).click();
  await page.locator("select").filter({ has: page.locator('option[value="connection-e2e"]') }).selectOption(connection.id);
  await page.getByRole("button", { name: "Start Chatting" }).click();
  await expect(page.getByPlaceholder(/Message/)).toBeVisible();
  await page.locator("div.absolute.inset-0.z-40").click({ position: { x: 10, y: 10 } });
}

test("conversation can be created, streamed, retried, and restored after reload", async ({ page }) => {
  await createConversation(page);

  await page.getByPlaceholder(/Message/).fill("Hello deterministic koi");
  await page.getByRole("button", { name: "Send" }).click();
  const firstReply = page.getByText("Deterministic streamed reply 1");
  await expect(firstReply).toBeVisible();
  await firstReply.hover();
  await page.getByRole("button", { name: "Regenerate", exact: true }).last().click();
  await expect(page.getByText("Deterministic streamed reply 2")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Hello deterministic koi")).toBeVisible();
  await expect(page.getByText("Deterministic streamed reply 2")).toBeVisible();
});

test("rejected chat creation shows actionable failure UI", async ({ page }) => {
  failChatCreation = true;
  await page.goto("/");
  await page.getByRole("button", { name: "Start Conversation chat" }).click();

  await expect(page.getByRole("alert")).toContainText("Couldn’t finish setup");
  await expect(page.getByRole("alert")).toContainText("Test runtime rejected chat creation.");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("game setup blocks incomplete dependent selections", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start Game chat" }).click();
  await expect(page.getByText("New Game Setup")).toBeVisible();

  while (await page.getByRole("button", { name: "Next" }).isVisible()) {
    await page.getByRole("button", { name: "Next" }).click();
  }

  const startGame = page.getByRole("button", { name: "Start Game" });
  await expect(startGame).toBeDisabled();
  await expect(startGame).toHaveAttribute("title", /Select a GM model/);
});
