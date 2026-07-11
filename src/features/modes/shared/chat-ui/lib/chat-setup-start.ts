export type ChatSetupStartResult = { ok: true } | { ok: false; message: string };

export async function runChatSetupStart(input: {
  persistMetadata: () => Promise<unknown>;
  generateSchedules: (() => Promise<unknown>) | null;
  finish: () => void;
}): Promise<ChatSetupStartResult> {
  try {
    await input.persistMetadata();
    await input.generateSchedules?.();
    input.finish();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message.trim() ? error.message : "Conversation setup failed.",
    };
  }
}
