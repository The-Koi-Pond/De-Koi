export type ChatSetupStartResult = { ok: true } | { ok: false; message: string };
export type ChatSetupStartGateResult = ChatSetupStartResult | { ok: false; busy: true };

export async function runChatSetupStart(input: {
  persistMetadata: () => Promise<unknown>;
  generateSchedules: (() => Promise<unknown>) | null;
  refreshStatusMessages?: () => Promise<unknown>;
  reportStatusRefreshFailure?: (error: unknown) => void;
  finish: () => void;
}): Promise<ChatSetupStartResult> {
  try {
    await input.persistMetadata();
    await input.generateSchedules?.();
    try {
      await input.refreshStatusMessages?.();
    } catch (error) {
      input.reportStatusRefreshFailure?.(error);
    }
    input.finish();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message.trim() ? error.message : "Conversation setup failed.",
    };
  }
}

export function createChatSetupStartGate() {
  let active = false;
  return async (input: Parameters<typeof runChatSetupStart>[0]): Promise<ChatSetupStartGateResult> => {
    if (active) return { ok: false, busy: true };
    active = true;
    try {
      return await runChatSetupStart(input);
    } finally {
      active = false;
    }
  };
}
