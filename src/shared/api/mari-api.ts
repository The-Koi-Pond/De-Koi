import type { MariEntryRequest, MariGatewayResponse } from "../../engine/mari/mari-entry";
import { invokeTauri } from "./tauri-client";

export const mariApi = {
  prompt: (request: MariEntryRequest) =>
    invokeTauri<MariGatewayResponse>("professor_mari_prompt", {
      request,
    }),
};
