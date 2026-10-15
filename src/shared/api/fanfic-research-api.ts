import type { FanficWebResearchGateway } from "../../engine/modes/fanfic/research";
import { invokeTauri } from "./tauri-client";

/** Server-side search and page reading for a fic that opted in to research. */
export const fanficResearchApi: FanficWebResearchGateway = {
  research: (input) => invokeTauri("fanfic_web_research", { body: input }),
};
