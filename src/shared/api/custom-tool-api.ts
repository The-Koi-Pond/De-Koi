import { invokeTauri } from "./tauri-client";

export const customToolApi = {
  capabilities: <T = unknown>() => invokeTauri<T>("custom_tool_capabilities"),
  execute: <T = unknown>(input: { toolName: string; arguments: unknown }) =>
    invokeTauri<T>("custom_tool_execute", { body: input }),
};
