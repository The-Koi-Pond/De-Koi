import { describe, expect, it } from "vitest";
import { findRemoteRuntimeDispatchMismatches } from "../../../scripts/check-remote-runtime-dispatch.mjs";

const libSource = `
tauri::generate_handler![
    storage_commands::profile_commands::profile_import,
    storage_commands::backup_commands::backup_list,
    storage_commands::local_file_commands::local_file_save,
]
`;

const dispatchSource = `
const NON_REMOTE_COMMANDS: &[&str] = &[
    "local_file_save",
];

pub async fn dispatch(state: &AppState, request: InvokeRequest) -> AppResult<Value> {
    let command = request.command.as_str();
    match command {
        "profile_import" => profile::profile_call(state).await,
        "backup_list" => backup::list_backups(state),
        _ => Err(AppError::bad_request("Unsupported command")),
    }
}
`;

const remoteRuntimeSource = `
const REMOTE_COMMANDS = new Set([
  "profile_import",
  "backup_list",
]);
`;

describe("remote runtime dispatch check", () => {
  it("accepts matching desktop, remote allowlist, and HTTP dispatch command surfaces", () => {
    expect(
      findRemoteRuntimeDispatchMismatches({ libSource, dispatchSource, remoteRuntimeSource }),
    ).toEqual([]);
  });

  it("reports commands missing from the TypeScript remote allowlist", () => {
    const badRemoteRuntimeSource = `
const REMOTE_COMMANDS = new Set([
  "profile_import",
]);
`;

    expect(
      findRemoteRuntimeDispatchMismatches({
        libSource,
        dispatchSource,
        remoteRuntimeSource: badRemoteRuntimeSource,
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: "remote_allowlist_mismatch",
        missing: ["backup_list"],
        extra: [],
      }),
    );
  });

  it("reports dispatch arms missing from Rust HTTP dispatch", () => {
    const badDispatchSource = `
const NON_REMOTE_COMMANDS: &[&str] = &[
    "local_file_save",
];

pub async fn dispatch(state: &AppState, request: InvokeRequest) -> AppResult<Value> {
    let command = request.command.as_str();
    match command {
        "profile_import" => profile::profile_call(state).await,
        _ => Err(AppError::bad_request("Unsupported command")),
    }
}
`;

    expect(
      findRemoteRuntimeDispatchMismatches({
        libSource,
        dispatchSource: badDispatchSource,
        remoteRuntimeSource,
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "http_dispatch_mismatch",
        missing: ["backup_list"],
        extra: [],
      }),
    ]);
  });
});
