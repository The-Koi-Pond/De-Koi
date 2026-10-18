// Saves demo chats from a running de-koi-server into docs/screenshots/demo/chats.json, so the README screenshots can
// be retaken later without a model. Only for re-recording the demo; the capture script reads the saved file.
//   node scripts/readme-screenshots/export-demo.mjs --runtime http://127.0.0.1:8787 --chats "Wren,The Halcyon"
import { writeFile } from "node:fs/promises";
import { format } from "prettier";
import { DEMO_CHARACTERS } from "./cast.mjs";
import { runtimeClient } from "./runtime.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const runtime = option("runtime");
const names = (option("chats") ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
if (!runtime || names.length === 0) {
  console.error('Usage: node scripts/readme-screenshots/export-demo.mjs --runtime <url> --chats "Chat A,Chat B"');
  process.exit(1);
}

const invoke = runtimeClient(runtime);
const characters = await invoke("storage_list", { entity: "characters" });
const keyById = new Map();
for (const character of characters) {
  const name = character.data?.name ?? character.name;
  const demo = DEMO_CHARACTERS.find((entry) => entry.card.name === name);
  if (demo) keyById.set(character.id, demo.key);
}
const characterKey = (id) => {
  if (!id) return null;
  const key = keyById.get(id);
  if (!key) throw new Error(`Chat uses character ${id}, which is not part of the demo cast`);
  return key;
};

const chats = await invoke("storage_list", { entity: "chats" });
const messages = await invoke("storage_list", { entity: "messages" });
const exported = [];
for (const name of names) {
  const chat = chats.find((entry) => entry.name === name);
  if (!chat) throw new Error(`No chat named "${name}"`);
  const metadata = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
  const own = messages
    .filter((message) => message.chatId === chat.id)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const first = Date.parse(own[0]?.createdAt ?? chat.createdAt);
  exported.push({
    id: chat.id,
    name: chat.name,
    mode: chat.mode,
    characters: (chat.characterIds ?? []).map(characterKey),
    personaId: chat.personaId ?? null,
    promptPresetId: chat.promptPresetId ?? null,
    metadata,
    messages: own.map((message) => {
      const swipes = (message.swipes ?? [])
        .map((swipe) => swipe.content)
        .filter((content) => typeof content === "string");
      return {
        id: message.id,
        role: message.role,
        character: characterKey(message.characterId),
        content: message.content,
        ...(swipes.length > 1 ? { swipes, activeSwipeIndex: message.activeSwipeIndex ?? 0 } : {}),
        secondsIn: Math.round((Date.parse(message.createdAt) - first) / 1000),
      };
    }),
  });
}
// Format like the rest of the repo so `pnpm format:check` stays green.
await writeFile("docs/screenshots/demo/chats.json", await format(JSON.stringify(exported), { parser: "json" }));
console.log(
  `Saved ${exported.length} chats (${exported.reduce((sum, chat) => sum + chat.messages.length, 0)} messages).`,
);
