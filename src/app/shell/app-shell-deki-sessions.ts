import type { DekiSessionsState } from "../../engine/deki/deki-history";

// The Deki-senpai API (history storage, migration, record schemas) is about
// 12 KiB gzip. The shell only needs its session list, so it loads the API on
// the first call instead of holding it in the home screen's startup load.
function loadDekiSessions() {
  return import("../../shared/api/deki-api").then((module) => module.dekiApi.sessions);
}

export const dekiSessionsApi = {
  list: async (): Promise<DekiSessionsState> => (await loadDekiSessions()).list(),
  create: async (): Promise<DekiSessionsState> => (await loadDekiSessions()).create(),
  select: async (sessionId: string): Promise<DekiSessionsState> => (await loadDekiSessions()).select(sessionId),
  delete: async (sessionId: string): Promise<DekiSessionsState> => (await loadDekiSessions()).delete(sessionId),
  deleteMany: async (sessionIds: readonly string[]): Promise<DekiSessionsState> =>
    (await loadDekiSessions()).deleteMany(sessionIds),
};
