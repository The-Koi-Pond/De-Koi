use crate::http_storage_dispatch;
use crate::state::AppState;
use crate::storage_commands::{
    admin, agents, avatars, backgrounds, backup, bot_browser, characters, chat_memory, chats,
    connection_secrets, custom_tools, deki, entity_images, exports, fonts, game_assets, generation,
    http, images, imports, integrations, knowledge, llm, lorebook_images, managed_thumbnails,
    personas, profile, prompts, shared, sidecar, sprites, translation, updates,
};
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
pub struct InvokeRequest {
    pub command: String,
    #[serde(default)]
    pub args: Option<Value>,
}

fn args_object(args: Option<Value>) -> AppResult<Map<String, Value>> {
    match args.unwrap_or(Value::Null) {
        Value::Null => Ok(Map::new()),
        Value::Object(object) => Ok(object),
        _ => Err(AppError::invalid_input("Invoke args must be an object")),
    }
}

fn required_string<'a>(args: &'a Map<String, Value>, key: &str) -> AppResult<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::invalid_input(format!("{key} is required")))
}

fn required_string_allow_empty<'a>(args: &'a Map<String, Value>, key: &str) -> AppResult<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_input(format!("{key} is required")))
}

fn optional_value(args: &Map<String, Value>, key: &str) -> Value {
    args.get(key).cloned().unwrap_or(Value::Null)
}

fn optional_string(args: &Map<String, Value>, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn optional_bool(args: &Map<String, Value>, key: &str) -> Option<bool> {
    args.get(key).and_then(Value::as_bool)
}

fn optional_u32(args: &Map<String, Value>, key: &str) -> Option<u32> {
    args.get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn optional_u32_strict(args: &Map<String, Value>, key: &str) -> AppResult<Option<u32>> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    let Some(value) = value.as_u64() else {
        return Err(AppError::invalid_input(format!(
            "{key} must be a positive integer"
        )));
    };
    u32::try_from(value)
        .map(Some)
        .map_err(|_| AppError::invalid_input(format!("{key} is too large")))
}

async fn dispatch_blocking_http_storage(
    state: &AppState,
    args: &Map<String, Value>,
    operation: impl FnOnce(&AppState, &Map<String, Value>) -> AppResult<Value> + Send + 'static,
) -> AppResult<Value> {
    let state = state.clone();
    let args = args.clone();
    tokio::task::spawn_blocking(move || operation(&state, &args))
        .await
        .map_err(|error| AppError::new("task_join_error", error.to_string()))?
}

fn required_string_vec(args: &Map<String, Value>, key: &str) -> AppResult<Vec<String>> {
    let values = args
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::invalid_input(format!("{key} is required")))?;
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| AppError::invalid_input(format!("{key} must contain strings")))
        })
        .collect()
}

fn optional_string_vec(args: &Map<String, Value>, key: &str) -> AppResult<Vec<String>> {
    let Some(value) = args.get(key) else {
        return Ok(Vec::new());
    };
    let Some(values) = value.as_array() else {
        return Err(AppError::invalid_input(format!("{key} must be an array")));
    };
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| AppError::invalid_input(format!("{key} must contain strings")))
        })
        .collect()
}

pub async fn dispatch(state: &AppState, request: InvokeRequest) -> AppResult<Value> {
    let command = request.command.as_str();
    let args = args_object(request.args)?;
    match command {
        "load_url_binary" => load_url_binary(state, &args).await,
        "profile_import" => profile::profile_call(
            state,
            "POST",
            &["import"],
            &shared::ParsedPath::new("/profile/import"),
            optional_value(&args, "envelope"),
        ),
        "backup_create" => backup::create_backup(state),
        "backup_list" => backup::list_backups(state),
        "backup_delete" => backup::delete_backup(state, required_string(&args, "name")?),
        "backup_download" => {
            backup::download_backup(state, optional_string(&args, "name").as_deref())
        }
        "prompt_export" => exports::export_prompt(state, required_string(&args, "presetId")?),
        "prompts_export_bulk" => exports::export_records(
            state,
            "marinara_presets",
            "prompts",
            json!({ "ids": required_string_vec(&args, "ids")? }),
        ),
        "character_export" => exports::export_record(
            state,
            "marinara_character",
            "characters",
            required_string(&args, "id")?,
            optional_string(&args, "format").as_deref(),
        ),
        "character_export_png" => {
            exports::export_character_png(state, required_string(&args, "id")?)
        }
        "character_embedded_lorebook_import" => {
            exports::import_character_embedded_lorebook(state, required_string(&args, "id")?)
        }
        "characters_export_bulk" => exports::export_records(
            state,
            "marinara_characters",
            "characters",
            json!({
                "ids": required_string_vec(&args, "ids")?,
                "format": optional_value(&args, "format"),
            }),
        ),
        "persona_export" => exports::export_record(
            state,
            "marinara_persona",
            "personas",
            required_string(&args, "id")?,
            optional_string(&args, "format").as_deref(),
        ),
        "personas_export_bulk" => exports::export_records(
            state,
            "marinara_personas",
            "personas",
            json!({
                "ids": required_string_vec(&args, "ids")?,
                "format": optional_value(&args, "format"),
            }),
        ),
        "lorebook_export" => exports::export_lorebook(
            state,
            required_string(&args, "id")?,
            optional_string(&args, "format").as_deref(),
        ),
        "lorebooks_export_bulk" => exports::export_lorebooks(
            state,
            json!({
                "ids": required_string_vec(&args, "ids")?,
                "format": optional_value(&args, "format"),
            }),
        ),
        "lorebook_vectorize" => {
            prompts::vectorize_lorebook(
                state,
                required_string(&args, "id")?,
                optional_value(&args, "body"),
            )
            .await
        }
        "backgrounds_list" => backgrounds::backgrounds_call(state, "GET", &[], Value::Null),
        "backgrounds_tags" => backgrounds::backgrounds_call(state, "GET", &["tags"], Value::Null),
        "background_upload" => background_upload(state, &args),
        "background_delete" => backgrounds::backgrounds_call(
            state,
            "DELETE",
            &[required_string(&args, "filename")?],
            Value::Null,
        ),
        "background_tags_update" => backgrounds::backgrounds_call(
            state,
            "PATCH",
            &[required_string(&args, "filename")?, "tags"],
            json!({ "tags": required_string_vec(&args, "tags")? }),
        ),
        "background_rename" => backgrounds::backgrounds_call(
            state,
            "PATCH",
            &[required_string(&args, "filename")?, "rename"],
            json!({ "name": required_string(&args, "name")? }),
        ),
        "fonts_list" => fonts::fonts_call(state, "GET", &[], Value::Null).await,
        "fonts_google_download" => {
            fonts::fonts_call(
                state,
                "POST",
                &["google", "download"],
                json!({ "family": required_string(&args, "family")? }),
            )
            .await
        }
        "bot_browser_get" => bot_browser_get(state, &args).await,
        "bot_browser_post" => bot_browser_post(state, &args).await,
        "game_assets_list" => game_assets_list(state, &args),
        "game_assets_manifest" => game_assets::game_assets_manifest(state),
        "game_assets_tree" => game_assets::game_assets_tree(state),
        "game_assets_rescan" => game_assets::game_assets_rescan(state),
        "game_assets_create_folder" => {
            let path = required_string(&args, "path")?;
            state.game_assets.create_folder(path)?;
            Ok(json!({ "path": path }))
        }
        "game_assets_delete_folder" => {
            let path = required_string(&args, "path")?;
            state
                .game_assets
                .remove_folder(path, optional_bool(&args, "recursive").unwrap_or(false))?;
            Ok(json!({ "deleted": true }))
        }
        "game_assets_delete_file" => {
            let path = required_string(&args, "path")?;
            let thumbnail_files = game_asset_managed_thumbnail_files(state, path);
            state.game_assets.remove_file(path)?;
            remove_game_asset_managed_thumbnail_files(thumbnail_files);
            Ok(json!({ "deleted": true }))
        }
        "game_assets_read_text" => Ok(json!({
            "content": state.game_assets.read_text(required_string(&args, "path")?)?
        })),
        "game_assets_write_text" => {
            state.game_assets.write_text(
                required_string(&args, "path")?,
                required_string_allow_empty(&args, "content")?,
            )?;
            Ok(json!({ "saved": true }))
        }
        "game_assets_rename" => {
            let path = required_string(&args, "path")?;
            let thumbnail_files = game_asset_managed_thumbnail_files(state, path);
            let result = state
                .game_assets
                .rename(path, required_string(&args, "newName")?);
            if result.is_ok() {
                remove_game_asset_managed_thumbnail_files(thumbnail_files);
            }
            result
        }
        "game_assets_move" => {
            let path = required_string(&args, "path")?;
            let thumbnail_files = game_asset_managed_thumbnail_files(state, path);
            let result = state.game_assets.move_to_folder(
                path,
                optional_string(&args, "targetFolder")
                    .as_deref()
                    .unwrap_or(""),
            );
            if result.is_ok() {
                remove_game_asset_managed_thumbnail_files(thumbnail_files);
            }
            result
        }
        "game_assets_copy" => state.game_assets.copy_to_folder(
            required_string(&args, "path")?,
            optional_string(&args, "targetFolder")
                .as_deref()
                .unwrap_or(""),
        ),
        "game_assets_move_bulk" => {
            let paths = required_string_vec(&args, "paths")?;
            Ok(move_game_assets_and_clear_succeeded_thumbnails(
                state,
                &paths,
                optional_string(&args, "targetFolder")
                    .as_deref()
                    .unwrap_or(""),
            ))
        }
        "game_assets_copy_bulk" => Ok(state.game_assets.copy_many(
            &required_string_vec(&args, "paths")?,
            optional_string(&args, "targetFolder")
                .as_deref()
                .unwrap_or(""),
        )),
        "game_assets_delete_bulk" => {
            let paths = required_string_vec(&args, "paths")?;
            Ok(delete_game_assets_and_clear_succeeded_thumbnails(
                state, &paths,
            ))
        }
        "game_assets_file_info" => state.game_assets.file_info(required_string(&args, "path")?),
        "game_assets_folder_description" => game_assets::game_assets_folder_description(
            state,
            json!({
                "path": required_string(&args, "path")?,
                "description": required_string_allow_empty(&args, "description")?,
            }),
        ),
        "game_assets_upload" => {
            game_assets::game_assets_upload(state, optional_value(&args, "body"))
        }
        "managed_asset_thumbnail_file_path" => {
            managed_thumbnails::managed_asset_thumbnail_file_path(
                state,
                required_string(&args, "kind")?,
                required_string(&args, "path")?,
                optional_u32_strict(&args, "size")?,
            )
        }
        "gif_search" => gif_search(&args).await,
        "tts_config" => integrations::tts_call(state, "GET", &["config"], Value::Null).await,
        "tts_update_config" => {
            integrations::tts_call(state, "PUT", &["config"], optional_value(&args, "config")).await
        }
        "tts_voices" => integrations::tts_call(state, "GET", &["voices"], Value::Null).await,
        "tts_speak" => {
            integrations::tts_call(state, "POST", &["speak"], optional_value(&args, "input")).await
        }
        "translate_text_command" => {
            translation::translate_text(state, optional_value(&args, "input")).await
        }
        "discord_webhook_send" => {
            integrations::discord_webhook_send(optional_value(&args, "body")).await
        }
        "spotify_status" => {
            spotify_direct(state, "POST", &["status"], optional_value(&args, "body")).await
        }
        "spotify_authorize" => {
            spotify_direct(
                state,
                "POST",
                &["authorize"],
                optional_value(&args, "input"),
            )
            .await
        }
        "spotify_exchange" => {
            spotify_direct(
                state,
                "POST",
                &["exchange"],
                json!({ "callbackUrl": required_string(&args, "callbackUrl")? }),
            )
            .await
        }
        "spotify_disconnect" => {
            spotify_direct(
                state,
                "POST",
                &["disconnect"],
                optional_value(&args, "body"),
            )
            .await
        }
        "spotify_player" => {
            spotify_direct(state, "GET", &["player"], optional_value(&args, "body")).await
        }
        "spotify_devices" => {
            spotify_direct(state, "GET", &["devices"], optional_value(&args, "body")).await
        }
        "spotify_access_token" => {
            spotify_direct(
                state,
                "GET",
                &["access-token"],
                optional_value(&args, "body"),
            )
            .await
        }
        "spotify_playlists" => spotify_playlists(state, &args).await,
        "spotify_playlist_tracks" => {
            spotify_direct(
                state,
                "POST",
                &["playlist-tracks"],
                optional_value(&args, "input"),
            )
            .await
        }
        "spotify_search_tracks" => {
            spotify_direct(
                state,
                "POST",
                &["search-tracks"],
                optional_value(&args, "input"),
            )
            .await
        }
        "spotify_play_track" => {
            spotify_direct(
                state,
                "POST",
                &["play-track"],
                optional_value(&args, "input"),
            )
            .await
        }
        "spotify_dj_deki_playlist" | "spotify_dj_mari_playlist" => {
            spotify_direct(
                state,
                "POST",
                &["dj-deki-playlist"],
                optional_value(&args, "input"),
            )
            .await
        }
        "spotify_player_play" => {
            spotify_direct(
                state,
                "PUT",
                &["player", "play"],
                optional_value(&args, "body"),
            )
            .await
        }
        "spotify_player_pause" => {
            spotify_direct(
                state,
                "PUT",
                &["player", "pause"],
                optional_value(&args, "body"),
            )
            .await
        }
        "spotify_player_next" => {
            spotify_direct(
                state,
                "POST",
                &["player", "next"],
                optional_value(&args, "body"),
            )
            .await
        }
        "spotify_player_previous" => {
            spotify_direct(
                state,
                "POST",
                &["player", "previous"],
                optional_value(&args, "body"),
            )
            .await
        }
        "spotify_player_transfer" => {
            spotify_direct(
                state,
                "PUT",
                &["player", "transfer"],
                optional_value(&args, "body"),
            )
            .await
        }
        "spotify_player_volume" => {
            spotify_direct(
                state,
                "PUT",
                &["player", "volume"],
                optional_value(&args, "body"),
            )
            .await
        }
        "spotify_player_shuffle" => {
            spotify_direct(
                state,
                "PUT",
                &["player", "shuffle"],
                optional_value(&args, "body"),
            )
            .await
        }
        "spotify_player_repeat" => {
            spotify_direct(
                state,
                "PUT",
                &["player", "repeat"],
                optional_value(&args, "body"),
            )
            .await
        }
        "knowledge_sources_list" => {
            knowledge::knowledge_sources_call(state, "GET", &[], Value::Null)
        }
        "knowledge_source_upload" => knowledge::knowledge_sources_call(
            state,
            "POST",
            &["upload"],
            optional_value(&args, "body"),
        ),
        "knowledge_source_delete" => knowledge::knowledge_sources_call(
            state,
            "DELETE",
            &[required_string(&args, "id")?],
            Value::Null,
        ),
        "knowledge_source_text" => knowledge::knowledge_sources_call(
            state,
            "GET",
            &[required_string(&args, "id")?, "text"],
            Value::Null,
        ),
        "import_marinara" => import_call(state, &args, &["marinara"], "envelope"),
        "import_marinara_file" => import_call(state, &args, &["marinara-file"], "body"),
        "import_st_character" => import_call(state, &args, &["st-character"], "body"),
        "import_st_character_batch" => {
            import_call(state, &args, &["st-character", "batch"], "body")
        }
        "import_st_character_inspect" => {
            import_call(state, &args, &["st-character", "inspect"], "body")
        }
        "import_st_chat" => import_call(state, &args, &["st-chat"], "body"),
        "import_st_chat_into_group" => import_call(state, &args, &["st-chat-into-group"], "body"),
        "import_st_preset" => import_call(state, &args, &["st-preset"], "payload"),
        "import_st_lorebook" => import_call(state, &args, &["st-lorebook"], "payload"),
        "import_list_directory" => remote_import_list_directory(state, &args),
        "import_st_bulk_scan" => import_call(state, &args, &["st-bulk", "scan"], "payload"),
        "import_st_bulk_run" => import_call(state, &args, &["st-bulk", "run"], "payload"),
        "custom_tool_execute" => {
            custom_tools::execute_custom_tool(state, optional_value(&args, "body")).await
        }
        "custom_tool_capabilities" => Ok(custom_tools::custom_tool_capabilities()),
        "agent_patch_by_type" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                agents::patch_agent_type(
                    state,
                    required_string(args, "agentType")?,
                    optional_value(args, "patch"),
                )
            })
            .await
        }
        "agent_toggle_by_type" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                agents::toggle_agent_type(state, required_string(args, "agentType")?)
            })
            .await
        }
        "agent_cadence_status" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                agents::agent_cadence_status(
                    state,
                    required_string(args, "agentType")?,
                    required_string(args, "chatId")?,
                )
            })
            .await
        }
        "storage_list" => {
            dispatch_blocking_http_storage(state, &args, http_storage_dispatch::storage_list).await
        }
        "lorebook_entries_list_by_lorebook_ids" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::lorebook_entries_list_by_lorebook_ids,
            )
            .await
        }
        "storage_get" => {
            dispatch_blocking_http_storage(state, &args, http_storage_dispatch::storage_get).await
        }
        "storage_create" => {
            dispatch_blocking_http_storage(state, &args, http_storage_dispatch::storage_create)
                .await
        }
        "storage_update" => {
            dispatch_blocking_http_storage(state, &args, http_storage_dispatch::storage_update)
                .await
        }
        "storage_delete" => {
            dispatch_blocking_http_storage(state, &args, http_storage_dispatch::storage_delete)
                .await
        }
        "storage_duplicate" => {
            dispatch_blocking_http_storage(state, &args, http_storage_dispatch::storage_duplicate)
                .await
        }
        "connection_folder_reorder" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::connection_folder_reorder,
            )
            .await
        }
        "lorebook_folder_reorder" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::lorebook_folder_reorder,
            )
            .await
        }
        "connection_move" => {
            dispatch_blocking_http_storage(state, &args, http_storage_dispatch::connection_move)
                .await
        }
        "chat_message_add_swipe" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::chat_message_add_swipe,
            )
            .await
        }
        "chat_message_update_content_if_unchanged" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::chat_message_update_content_if_unchanged,
            )
            .await
        }
        "chat_message_set_active_swipe" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::chat_message_set_active_swipe,
            )
            .await
        }
        "chat_message_delete_swipe" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::chat_message_delete_swipe,
            )
            .await
        }
        "chat_evict_prompt_snapshots" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::chat_evict_prompt_snapshots,
            )
            .await
        }
        "chat_autonomous_unread_mark" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::chat_autonomous_unread_mark,
            )
            .await
        }
        "chat_autonomous_unread_clear" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::chat_autonomous_unread_clear,
            )
            .await
        }
        "tracker_snapshot_latest" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::tracker_snapshot_latest,
            )
            .await
        }
        "tracker_snapshot_get" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::tracker_snapshot_get,
            )
            .await
        }
        "tracker_snapshot_save" => {
            dispatch_blocking_http_storage(
                state,
                &args,
                http_storage_dispatch::tracker_snapshot_save,
            )
            .await
        }
        "chat_memories_list" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                let exclude_recent_message_ids =
                    optional_string_vec(args, "excludeRecentMessageIds")?;
                let exclude_recent_start_at = optional_string(args, "excludeRecentStartAt");
                chat_memory::list_chat_memories_excluding_recent(
                    state,
                    required_string(args, "chatId")?,
                    optional_u32_strict(args, "limit")?.map(|value| value as usize),
                    optional_string(args, "order").as_deref(),
                    &exclude_recent_message_ids,
                    exclude_recent_start_at.as_deref(),
                )
            })
            .await
        }
        "chat_memory_delete" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chat_memory::delete_chat_memory(
                    state,
                    required_string(args, "chatId")?,
                    required_string(args, "memoryId")?,
                )
            })
            .await
        }
        "chat_memories_clear" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chat_memory::clear_chat_memories(state, required_string(args, "chatId")?)
            })
            .await
        }
        "chat_memories_refresh" => {
            chat_memory::refresh_chat_memories(state, required_string(&args, "chatId")?).await
        }
        "chat_memories_export" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chat_memory::export_chat_memories(state, required_string(args, "chatId")?)
            })
            .await
        }
        "chat_memories_import" => {
            chat_memory::import_chat_memories(
                state,
                required_string(&args, "chatId")?,
                optional_value(&args, "body"),
                optional_bool(&args, "replace"),
            )
            .await
        }
        "chat_notes_list" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chats::list_chat_notes(state, required_string(args, "chatId")?)
            })
            .await
        }
        "chat_note_delete" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chats::delete_chat_note(
                    state,
                    required_string(args, "chatId")?,
                    required_string(args, "noteId")?,
                )
            })
            .await
        }
        "chat_notes_clear" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chats::clear_chat_notes(state, required_string(args, "chatId")?)
            })
            .await
        }
        "chat_group_delete" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chats::delete_chat_group(state, required_string(args, "groupId")?)
            })
            .await
        }
        "chat_messages_bulk_delete" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chats::bulk_delete_messages(
                    state,
                    required_string(args, "chatId")?,
                    json!({ "messageIds": required_string_vec(args, "messageIds")? }),
                )
            })
            .await
        }
        "chat_message_count" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                Ok(json!({
                    "count": state
                        .storage
                        .count_messages_for_chat(required_string(args, "chatId")?)?
                }))
            })
            .await
        }
        "chat_branch" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chats::branch_chat(
                    state,
                    required_string(args, "chatId")?,
                    json!({ "upToMessageId": optional_value(args, "upToMessageId") }),
                )
            })
            .await
        }
        "chat_message_swipes" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                chats::message_swipes(
                    state,
                    "GET",
                    required_string(args, "chatId")?,
                    required_string(args, "messageId")?,
                    Value::Null,
                )
            })
            .await
        }
        "chat_connect" => {
            dispatch_blocking_http_storage(state, &args, http_storage_dispatch::chat_connect).await
        }
        "chat_disconnect" => {
            dispatch_blocking_http_storage(state, &args, http_storage_dispatch::chat_disconnect)
                .await
        }
        "admin_expunge_command" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                admin::admin_expunge(
                    state,
                    json!({ "confirm": true, "scopes": required_string_vec(args, "scopes")? }),
                )
            })
            .await
        }
        "admin_clear_all_command" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                admin::admin_clear_all(state, json!({ "confirm": optional_bool(args, "confirm") }))
            })
            .await
        }
        "agent_memory_get" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                agents::agent_memory(
                    state,
                    "GET",
                    required_string(args, "agentType")?,
                    required_string(args, "chatId")?,
                    Value::Null,
                )
            })
            .await
        }
        "agent_memory_patch" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                agents::agent_memory(
                    state,
                    "PATCH",
                    required_string(args, "agentType")?,
                    required_string(args, "chatId")?,
                    json!({ "patch": optional_value(args, "patch") }),
                )
            })
            .await
        }
        "agent_memory_clear" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                agents::agent_memory(
                    state,
                    "DELETE",
                    required_string(args, "agentType")?,
                    required_string(args, "chatId")?,
                    Value::Null,
                )
            })
            .await
        }
        "agent_runs_clear_for_chat" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                agents::clear_agent_runs_and_memory_for_chat(
                    state,
                    required_string(args, "chatId")?,
                )
            })
            .await
        }
        "agent_echo_messages_clear" => {
            dispatch_blocking_http_storage(state, &args, |state, args| {
                agents::echo_messages(state, "DELETE", required_string(args, "chatId")?)
            })
            .await
        }
        "connection_test" => connection_test(state, &args).await,
        "connection_test_message" => connection_test_message(state, &args).await,
        "connection_test_image" => connection_test_image(state, &args).await,
        "connection_diagnose_claude_subscription" => {
            connection_diagnose_claude_subscription(state, &args).await
        }
        "connection_models" => connection_models(state, &args).await,
        "connection_save_default_parameters" => {
            dispatch_blocking_http_storage(state, &args, connection_save_default_parameters).await
        }
        "character_gallery_upload" => character_gallery_upload(state, &args),
        "persona_gallery_upload" => persona_gallery_upload(state, &args),
        "global_gallery_upload" => global_gallery_upload(state, &args),
        "chat_gallery_upload" => chat_gallery_upload(state, &args),
        "sprite_capabilities_command" => sprites::sprite_capabilities(state),
        "sprite_cleanup_status_command" => sprites::sprite_cleanup_status(state),
        "image_generate" => image_generate(state, &args).await,
        "avatar_generation_preview_command" => {
            images::avatar_generation_preview(state, optional_value(&args, "body"))
        }
        "avatar_generation_command" => avatar_generation_command(state, &args).await,
        "sprite_generate_sheet" => sprite_generate_sheet(state, &args).await,
        "sprite_generate_sheet_preview" => sprite_generate_sheet_preview(state, &args).await,
        "sprite_cleanup" => {
            sprites::cleanup_generated_sprites(state, optional_value(&args, "body"))
        }
        "sprite_list" => sprites::list_sprites(
            state,
            required_string(&args, "characterId")?,
            optional_string(&args, "ownerType").as_deref(),
        ),
        "sprite_export" => exports::export_sprite_archive(
            state,
            required_string(&args, "characterId")?,
            optional_value(&args, "body"),
            optional_string(&args, "ownerType").as_deref(),
        ),
        "sprite_upload" => sprites::upload_sprite(
            state,
            required_string(&args, "characterId")?,
            optional_value(&args, "body"),
            optional_string(&args, "ownerType").as_deref(),
        ),
        "sprite_upload_bulk" => sprites::upload_sprites(
            state,
            required_string(&args, "characterId")?,
            optional_value(&args, "body"),
            optional_string(&args, "ownerType").as_deref(),
        ),
        "sprite_delete" => sprites::delete_sprite(
            state,
            required_string(&args, "characterId")?,
            required_string(&args, "expression")?,
            optional_string(&args, "ownerType").as_deref(),
        ),
        "sprite_cleanup_saved" => sprites::clean_saved_sprites(
            state,
            required_string(&args, "characterId")?,
            optional_value(&args, "body"),
            optional_string(&args, "ownerType").as_deref(),
        ),
        "sprite_cleanup_restore" => sprites::restore_sprite_cleanup_point(
            state,
            required_string(&args, "characterId")?,
            optional_value(&args, "body"),
            optional_string(&args, "ownerType").as_deref(),
        ),
        "persona_activate" => personas::activate_persona(state, required_string(&args, "id")?),
        "character_avatar_upload" => avatars::update_character_avatar(
            state,
            "characters",
            required_string(&args, "id")?,
            optional_value(&args, "body"),
        ),
        "character_avatar_remove" => {
            avatars::remove_character_avatar(state, required_string(&args, "id")?)
        }
        "avatar_thumbnail_file_path" => avatars::avatar_thumbnail_file_path(
            state,
            optional_string(&args, "filename").as_deref(),
            optional_string(&args, "absolutePath").as_deref(),
            optional_string(&args, "sourceUrl").as_deref(),
            optional_u32_strict(&args, "size")?,
        ),
        "character_restore_version" => characters::restore_character_version(
            state,
            required_string(&args, "characterId")?,
            required_string(&args, "versionId")?,
        ),
        "persona_avatar_upload" => avatars::update_character_avatar(
            state,
            "personas",
            required_string(&args, "id")?,
            optional_value(&args, "body"),
        ),
        "npc_avatar_upload" => avatars::update_npc_avatar(
            state,
            required_string(&args, "chatId")?,
            optional_value(&args, "body"),
        ),
        "lorebook_image_upload" => lorebook_images::update_lorebook_image(
            state,
            required_string(&args, "id")?,
            optional_value(&args, "body"),
        ),
        "agent_image_upload" => entity_images::update_entity_image(
            state,
            "agents",
            required_string(&args, "id")?,
            optional_value(&args, "body"),
        ),
        "agent_type_image_upload" => agents::update_agent_image_by_type(
            state,
            required_string(&args, "agentType")?,
            optional_value(&args, "body"),
        ),
        "connection_image_upload" => entity_images::update_entity_image(
            state,
            "connections",
            required_string(&args, "id")?,
            optional_value(&args, "body"),
        ),
        "llm_complete" => llm::llm_complete(state, optional_value(&args, "request")).await,
        "llm_embed" => llm::llm_embed(state, optional_value(&args, "body")).await,
        "llm_list_models" => {
            llm::llm_models(state, optional_string(&args, "connectionId").as_deref()).await
        }
        "llm_stream_cancel" => llm_stream_cancel(state, &args),
        "local_sidecar_status" => sidecar::status(state).await,
        "local_sidecar_update_config" => {
            sidecar::update_config(state, optional_value(&args, "body")).await
        }
        "local_sidecar_runtime_install" => {
            sidecar::runtime_install(state, optional_value(&args, "body")).await
        }
        "local_sidecar_download_curated" => {
            sidecar::download_curated(state, optional_value(&args, "body")).await
        }
        "local_sidecar_list_huggingface_models" => {
            sidecar::list_huggingface_models(state, optional_value(&args, "body")).await
        }
        "local_sidecar_download_custom" => {
            sidecar::download_custom(state, optional_value(&args, "body")).await
        }
        "local_sidecar_download_cancel" => sidecar::download_cancel(state).await,
        "local_sidecar_delete_model" => sidecar::delete_model(state).await,
        "local_sidecar_start" => sidecar::start(state).await,
        "local_sidecar_stop" => sidecar::stop(state).await,
        "local_sidecar_restart" => sidecar::restart(state).await,
        "local_sidecar_test_message" => sidecar::test_message(state).await,
        "deki_prompt" | "professor_mari_prompt" => {
            deki::deki_prompt(state, optional_value(&args, "request")).await
        }
        "deki_workspace_status" => {
            deki::deki_workspace_status(state, optional_string(&args, "connectionId")).await
        }
        "deki_workspace_abort" => deki::deki_workspace_abort(state).await,
        "deki_workspace_approve" => {
            deki::deki_workspace_approve(state, required_string(&args, "id")?.to_string()).await
        }
        "deki_workspace_reject" => {
            deki::deki_workspace_reject(state, required_string(&args, "id")?.to_string()).await
        }
        "update_check" => updates::check_updates().await,
        "update_apply" => updates::apply_update(optional_value(&args, "input")),
        _ => Err(AppError::new(
            "unsupported_command",
            format!("{command} is not exposed by the remote runtime"),
        )),
    }
}

async fn load_url_binary(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    http::load_url_binary_for_state(
        state,
        required_string(args, "url")?,
        optional_string(args, "fallbackMime")
            .as_deref()
            .unwrap_or("application/octet-stream"),
    )
    .await
}

fn bot_browser_route(path: &str) -> shared::ParsedPath {
    let trimmed = path.trim_start_matches('/');
    let local = trimmed.strip_prefix("bot-browser/").unwrap_or(trimmed);
    shared::ParsedPath::new(local)
}

async fn bot_browser_get(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    let route = bot_browser_route(required_string(args, "path")?);
    let rest = route.parts.iter().map(String::as_str).collect::<Vec<_>>();
    bot_browser::bot_browser_call(state, "GET", &rest, &route, Value::Null).await
}

async fn bot_browser_post(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    let route = bot_browser_route(required_string(args, "path")?);
    let rest = route.parts.iter().map(String::as_str).collect::<Vec<_>>();
    bot_browser::bot_browser_call(state, "POST", &rest, &route, optional_value(args, "body")).await
}

fn game_assets_list(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    Ok(json!({
        "items": state.game_assets.list(optional_string(args, "path").as_deref())?,
        "root": state.game_assets.root().to_string_lossy()
    }))
}

fn game_asset_managed_thumbnail_files(state: &AppState, path: &str) -> Vec<PathBuf> {
    let Ok(source) = state
        .game_assets
        .absolute_path_string(path)
        .map(PathBuf::from)
        .and_then(|path| std::fs::canonicalize(path).map_err(AppError::from))
    else {
        return Vec::new();
    };
    let Ok(root) = std::fs::canonicalize(state.data_dir.join("game-assets")) else {
        return Vec::new();
    };
    let Ok(relative) = source.strip_prefix(root) else {
        return Vec::new();
    };
    [64, 128, 256, 512]
        .into_iter()
        .map(|size| game_asset_managed_thumbnail_file(state, size, relative))
        .collect()
}

fn game_asset_managed_thumbnail_file(state: &AppState, size: u32, relative: &Path) -> PathBuf {
    let mut target = state
        .data_dir
        .join(".managed-thumbnails")
        .join("game")
        .join(size.to_string())
        .join(relative);
    let filename = target
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "asset".to_string());
    target.set_file_name(format!("{filename}.thumb.png"));
    target
}

fn remove_game_asset_managed_thumbnail_files(paths: Vec<PathBuf>) {
    for path in paths {
        if path.is_file() {
            if let Err(error) = std::fs::remove_file(&path) {
                log::warn!(
                    "could not remove managed thumbnail {}: {error}",
                    path.display()
                );
            }
        }
    }
}

fn delete_game_assets_and_clear_succeeded_thumbnails(state: &AppState, paths: &[String]) -> Value {
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    for path in paths {
        let thumbnail_files = game_asset_managed_thumbnail_files(state, path);
        match state.game_assets.remove_file(path) {
            Ok(()) => {
                remove_game_asset_managed_thumbnail_files(thumbnail_files);
                succeeded.push(Value::String(path.clone()));
            }
            Err(error) => failed.push(json!({ "path": path, "error": error.message })),
        }
    }
    json!({ "succeeded": succeeded, "failed": failed })
}

fn move_game_assets_and_clear_succeeded_thumbnails(
    state: &AppState,
    paths: &[String],
    target_folder: &str,
) -> Value {
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    for path in paths {
        let thumbnail_files = game_asset_managed_thumbnail_files(state, path);
        match state.game_assets.move_to_folder(path, target_folder) {
            Ok(_) => {
                remove_game_asset_managed_thumbnail_files(thumbnail_files);
                succeeded.push(Value::String(path.clone()));
            }
            Err(error) => failed.push(json!({ "path": path, "error": error.message })),
        }
    }
    json!({ "succeeded": succeeded, "failed": failed, "targetFolder": target_folder })
}

async fn gif_search(args: &Map<String, Value>) -> AppResult<Value> {
    let mut query = HashMap::new();
    if let Some(q) = optional_string(args, "q") {
        query.insert("q".to_string(), q);
    }
    if let Some(limit) = optional_u32(args, "limit") {
        query.insert("limit".to_string(), limit.to_string());
    }
    if let Some(pos) = optional_string(args, "pos") {
        query.insert("pos".to_string(), pos);
    }
    http::gifs_search(&shared::ParsedPath {
        parts: Vec::new(),
        query,
    })
    .await
}

async fn spotify_direct(
    state: &AppState,
    method: &str,
    rest: &[&str],
    body: Value,
) -> AppResult<Value> {
    integrations::spotify_call(
        state,
        method,
        rest,
        &shared::ParsedPath::new("/spotify"),
        body,
    )
    .await
}

async fn spotify_playlists(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    let route = shared::ParsedPath::new(&format!(
        "/spotify/playlists?limit={}",
        optional_u32(args, "limit").unwrap_or(50)
    ));
    integrations::spotify_call(
        state,
        "GET",
        &["playlists"],
        &route,
        json!({ "agentId": optional_value(args, "agentId") }),
    )
    .await
}

async fn connection_test(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    generation::test_connection(state, required_string(args, "id")?).await
}

async fn connection_test_message(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    generation::test_message(state, required_string(args, "id")?).await
}

async fn connection_test_image(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    images::test_image_generation(state, required_string(args, "id")?).await
}

async fn connection_models(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    llm::connection_models(state, required_string(args, "id")?).await
}

async fn connection_diagnose_claude_subscription(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    llm::connection_diagnose_claude_subscription(state, required_string(args, "id")?).await
}

fn connection_save_default_parameters(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    connection_secrets::save_default_parameters(
        state,
        required_string(args, "id")?,
        optional_value(args, "params"),
    )
}

fn import_call(
    state: &AppState,
    args: &Map<String, Value>,
    rest: &[&str],
    payload_key: &str,
) -> AppResult<Value> {
    imports::import_call(state, rest, optional_value(args, payload_key))
}

fn remote_import_list_directory(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    if optional_bool(args, "pickerSelected") == Some(true) {
        return Err(AppError::invalid_input(
            "pickerSelected is only trusted through the native folder picker",
        ));
    }

    imports::import_call(
        state,
        &["list-directory"],
        json!({
            "path": optional_string(args, "path").unwrap_or_default(),
            "pickerSelected": false,
        }),
    )
}

fn background_upload(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    backgrounds::backgrounds_call(state, "POST", &["upload"], optional_value(args, "body"))
}

fn character_gallery_upload(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    shared::upload_character_gallery_image(
        state,
        required_string(args, "characterId")?,
        optional_value(args, "body"),
    )
}

fn persona_gallery_upload(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    shared::upload_gallery_image(
        state,
        "persona-gallery",
        "personaId",
        required_string(args, "personaId")?,
        optional_value(args, "body"),
    )
}

fn global_gallery_upload(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    shared::upload_global_gallery_image(
        state,
        optional_string(args, "folderId").as_deref(),
        optional_value(args, "body"),
    )
}

fn chat_gallery_upload(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    shared::upload_gallery_image(
        state,
        "gallery",
        "chatId",
        required_string(args, "chatId")?,
        optional_value(args, "body"),
    )
}

async fn image_generate(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    images::generate_image(state, optional_value(args, "body")).await
}

async fn avatar_generation_command(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    images::avatar_generation(state, optional_value(args, "body")).await
}

async fn sprite_generate_sheet(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    sprites::generate_sprite_sheet(state, optional_value(args, "body")).await
}

async fn sprite_generate_sheet_preview(
    state: &AppState,
    args: &Map<String, Value>,
) -> AppResult<Value> {
    sprites::generate_sprite_sheet_preview(state, optional_value(args, "body")).await
}

fn llm_stream_cancel(state: &AppState, args: &Map<String, Value>) -> AppResult<Value> {
    llm::llm_stream_cancel(state, required_string(args, "streamId")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage_commands::media_uploads::file_path_asset_url;
    use base64::{engine::general_purpose, Engine as _};
    use std::collections::BTreeSet;
    use std::io::Cursor;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    // Commands that stay out of /api/invoke because they require the client shell,
    // local filesystem paths, Tauri IPC channels, or user-machine devices.
    const NON_REMOTE_COMMANDS: &[&str] = &[
        "fonts_open_folder",
        "background_file_path",
        "gallery_file_path",
        "game_assets_file_path",
        "game_assets_open_folder",
        "import_st_bulk_run_events",
        "local_file_save",
        "local_file_save_cleanup",
        "lorebook_image_file_path",
        "llm_stream_channel",
        "profile_export",
        "profile_import_preview_file",
        "profile_import_preview_upload",
        "profile_import_file",
        "profile_import_file_events",
        "profile_import_upload",
    ];

    const BLOCKING_STORAGE_REMOTE_COMMANDS: &[&str] = &[
        "admin_clear_all_command",
        "admin_expunge_command",
        "agent_cadence_status",
        "agent_echo_messages_clear",
        "agent_memory_clear",
        "agent_memory_get",
        "agent_memory_patch",
        "agent_patch_by_type",
        "agent_runs_clear_for_chat",
        "agent_toggle_by_type",
        "chat_autonomous_unread_clear",
        "chat_autonomous_unread_mark",
        "chat_branch",
        "chat_connect",
        "chat_disconnect",
        "chat_evict_prompt_snapshots",
        "chat_group_delete",
        "chat_memories_clear",
        "chat_memories_export",
        "chat_memories_list",
        "chat_memory_delete",
        "chat_message_add_swipe",
        "chat_message_count",
        "chat_message_delete_swipe",
        "chat_message_set_active_swipe",
        "chat_message_swipes",
        "chat_message_update_content_if_unchanged",
        "chat_messages_bulk_delete",
        "chat_note_delete",
        "chat_notes_clear",
        "chat_notes_list",
        "connection_folder_reorder",
        "connection_move",
        "connection_save_default_parameters",
        "lorebook_entries_list_by_lorebook_ids",
        "lorebook_folder_reorder",
        "storage_create",
        "storage_delete",
        "storage_duplicate",
        "storage_get",
        "storage_list",
        "storage_update",
        "tracker_snapshot_get",
        "tracker_snapshot_latest",
        "tracker_snapshot_save",
    ];

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-http-dispatch-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dispatch dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn upload_body(name: &str) -> Value {
        let image = image::RgbaImage::from_pixel(1, 1, image::Rgba([255_u8, 0_u8, 0_u8, 255_u8]));
        let mut cursor = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .expect("test PNG should encode");
        let bytes = cursor.into_inner();
        json!({
            "file": {
                "name": name,
                "type": "image/png",
                "size": bytes.len(),
                "base64": general_purpose::STANDARD.encode(bytes)
            }
        })
    }

    fn seed_character(state: &AppState, id: &str) {
        state
            .storage
            .upsert_with_id(
                "characters",
                id,
                json!({
                    "id": id,
                    "name": "Seed Character"
                }),
            )
            .expect("character should write");
    }

    fn character_exists(state: &AppState, id: &str) -> bool {
        state
            .storage
            .get("characters", id)
            .expect("characters should be readable")
            .is_some()
    }

    #[tokio::test]
    async fn dispatch_rejects_unknown_agent_by_type_commands() {
        for (label, command, args) in [
            (
                "patch",
                "agent_patch_by_type",
                json!({ "agentType": "bogus-agent", "patch": { "enabled": true } }),
            ),
            (
                "toggle",
                "agent_toggle_by_type",
                json!({ "agentType": "bogus-agent" }),
            ),
            (
                "cadence",
                "agent_cadence_status",
                json!({ "agentType": "bogus-agent", "chatId": "chat-1" }),
            ),
            (
                "image-upload",
                "agent_type_image_upload",
                json!({ "agentType": "bogus-agent", "body": upload_body("bogus-agent.png") }),
            ),
        ] {
            let state = test_state(&format!("unknown-agent-{label}"));
            let error = dispatch(
                &state,
                InvokeRequest {
                    command: command.to_string(),
                    args: Some(args),
                },
            )
            .await
            .expect_err("unknown by-type agent command should reject");

            assert_eq!(
                error.code, "not_found",
                "{command} should reject unknown types"
            );
            assert!(
                state
                    .storage
                    .list("agents")
                    .expect("agents should be readable")
                    .is_empty(),
                "{command} must not create an arbitrary agent row"
            );
        }
    }

    #[tokio::test]
    async fn dispatch_accepts_known_builtin_agent_by_type_commands() {
        let state = test_state("known-builtin-agent-dispatch");

        let patched = dispatch(
            &state,
            InvokeRequest {
                command: "agent_patch_by_type".to_string(),
                args: Some(json!({ "agentType": "director", "patch": { "enabled": false } })),
            },
        )
        .await
        .expect("known built-in by-type patch should dispatch");
        let status = dispatch(
            &state,
            InvokeRequest {
                command: "agent_cadence_status".to_string(),
                args: Some(json!({ "agentType": "director", "chatId": "chat-1" })),
            },
        )
        .await
        .expect("known built-in cadence status should dispatch");

        assert_eq!(
            patched.get("type").and_then(Value::as_str),
            Some("director")
        );
        assert_eq!(patched.get("enabled").and_then(Value::as_bool), Some(false));
        assert_eq!(status["agentType"], "director");
        assert_eq!(status["runInterval"], 5);

        let uploaded = dispatch(
            &state,
            InvokeRequest {
                command: "agent_type_image_upload".to_string(),
                args: Some(json!({
                    "agentType": "illustrator",
                    "body": {
                        "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lTmZsgAAAABJRU5ErkJggg==",
                        "filename": "illustrator.png"
                    }
                })),
            },
        )
        .await
        .expect("known built-in by-type image upload should dispatch");

        assert_eq!(
            uploaded.get("type").and_then(Value::as_str),
            Some("illustrator")
        );
        assert!(uploaded
            .get("imagePath")
            .and_then(Value::as_str)
            .is_some_and(|path| !path.starts_with("data:image/")));
    }

    fn write_game_asset_png(state: &AppState, path: &str) {
        let absolute = PathBuf::from(
            state
                .game_assets
                .absolute_path_string(path)
                .expect("asset path should be valid"),
        );
        if let Some(parent) = absolute.parent() {
            std::fs::create_dir_all(parent).expect("asset parent should be created");
        }
        image::RgbaImage::from_pixel(32, 32, image::Rgba([255, 0, 0, 255]))
            .save(&absolute)
            .expect("game asset fixture should write");
    }

    async fn create_remote_game_thumbnail(state: &AppState, path: &str) -> PathBuf {
        let response = dispatch(
            state,
            InvokeRequest {
                command: "managed_asset_thumbnail_file_path".to_string(),
                args: Some(json!({
                    "kind": "game",
                    "path": path,
                    "size": 128
                })),
            },
        )
        .await
        .expect("remote managed thumbnail should be created");

        let thumbnail = PathBuf::from(
            response
                .get("path")
                .and_then(Value::as_str)
                .expect("thumbnail path should be returned"),
        );
        assert!(
            thumbnail.is_file(),
            "thumbnail should exist before mutation"
        );
        thumbnail
    }

    fn quoted_commands(source: &str) -> BTreeSet<String> {
        source
            .split('"')
            .skip(1)
            .step_by(2)
            .filter(|value| {
                value
                    .chars()
                    .all(|character| character.is_ascii_lowercase() || character == '_')
            })
            .map(ToOwned::to_owned)
            .collect()
    }

    fn dispatch_arm_commands(source: &str) -> BTreeSet<String> {
        source
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim_start();
                if !trimmed.starts_with('"') || !trimmed.contains("=>") {
                    return None;
                }
                let arm_head = trimmed.split("=>").next()?;
                Some(quoted_commands(arm_head))
            })
            .flatten()
            .collect()
    }

    fn dispatch_match_source() -> &'static str {
        include_str!("http_dispatch.rs")
            .split("match command {")
            .nth(1)
            .and_then(|rest| rest.split("_ => Err").next())
            .expect("http dispatch match should be parseable")
    }

    fn dispatch_arm_source<'a>(source: &'a str, command: &str) -> Option<&'a str> {
        source.split("\n        \"").skip(1).find(|arm| {
            arm.split('"')
                .next()
                .is_some_and(|arm_command| arm_command == command)
        })
    }

    fn desktop_commands() -> BTreeSet<String> {
        let source = include_str!("lib.rs");
        source
            .split("storage_commands::")
            .skip(1)
            .filter_map(|rest| rest.split("::").nth(1))
            .filter_map(|rest| {
                let command = rest
                    .chars()
                    .take_while(|character| character.is_ascii_alphanumeric() || *character == '_')
                    .collect::<String>();
                (!command.is_empty()).then_some(command)
            })
            .collect()
    }

    #[tokio::test]
    async fn dispatch_chat_memories_list_rejects_malformed_limit() {
        let state = test_state("chat-memories-malformed-limit");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": []
                }),
            )
            .expect("chat should be created");

        let error = dispatch(
            &state,
            InvokeRequest {
                command: "chat_memories_list".to_string(),
                args: Some(json!({ "chatId": "chat-1", "limit": "500" })),
            },
        )
        .await
        .expect_err("remote memory listing should reject malformed limits");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("limit"));
    }

    #[tokio::test]
    async fn dispatch_chat_memories_import_uses_explicit_replace_arg() {
        let state = test_state("chat-memories-import-explicit-replace");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Memory chat",
                    "memories": [
                        {
                            "id": "existing",
                            "chatId": "chat-1",
                            "content": "replace me",
                            "messageCount": 5,
                            "firstMessageAt": "2026-06-01T10:00:00.000Z",
                            "lastMessageAt": "2026-06-01T10:04:00.000Z",
                            "createdAt": "2026-06-01T10:05:00.000Z"
                        }
                    ]
                }),
            )
            .expect("chat should be created");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "chat_memories_import".to_string(),
                args: Some(json!({
                    "chatId": "chat-1",
                    "replace": true,
                    "body": {
                        "type": "marinara_memory_recall",
                        "version": 1,
                        "data": {
                            "sourceChat": {
                                "id": "chat-1",
                                "name": "Memory chat",
                                "mode": "conversation",
                                "memoryCount": 1
                            },
                            "chunks": [
                                {
                                    "content": "replacement memory",
                                    "embedding": null,
                                    "messageCount": 1,
                                    "firstMessageAt": "2026-06-02T10:00:00.000Z",
                                    "lastMessageAt": "2026-06-02T10:01:00.000Z",
                                    "createdAt": "2026-06-02T10:02:00.000Z"
                                }
                            ]
                        }
                    }
                })),
            },
        )
        .await
        .expect("explicit replace should import");

        assert_eq!(result["imported"], json!(1));
        assert_eq!(result["skipped"], json!(0));
        assert_eq!(result["replaced"], json!(true));
        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memories = chat["memories"]
            .as_array()
            .expect("memories should be an array");
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0]["content"], json!("replacement memory"));
    }

    #[tokio::test]
    async fn dispatch_chat_memory_delete_preserves_serialized_non_target_chunks() {
        let state = test_state("chat-memory-delete-serialized");
        let memories = serde_json::to_string(&json!([
            { "id": "delete-me", "lastMessageAt": "2026-01-01T00:00:00.000Z" },
            { "id": "keep-me", "lastMessageAt": "2026-01-02T00:00:00.000Z" }
        ]))
        .expect("memory fixture should serialize");
        state
            .storage
            .create(
                "chats",
                json!({
                    "id": "chat-1",
                    "name": "Serialized memory chat",
                    "memories": memories
                }),
            )
            .expect("chat should be created");

        dispatch(
            &state,
            InvokeRequest {
                command: "chat_memory_delete".to_string(),
                args: Some(json!({ "chatId": "chat-1", "memoryId": "delete-me" })),
            },
        )
        .await
        .expect("remote memory delete should dispatch");

        let chat = state
            .storage
            .get("chats", "chat-1")
            .expect("chat should read")
            .expect("chat should exist");
        let memory_ids = chat["memories"]
            .as_array()
            .expect("memories should normalize to an array")
            .iter()
            .filter_map(|memory| memory.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(memory_ids, vec!["keep-me"]);
    }

    #[test]
    fn remote_runtime_command_surfaces_match_desktop_minus_documented_non_remote_commands() {
        let mut expected_remote = desktop_commands();
        for command in NON_REMOTE_COMMANDS {
            assert!(
                expected_remote.remove(*command),
                "{command} should still exist in the desktop command surface"
            );
        }

        let remote_runtime = include_str!("../../src/shared/api/remote-runtime.ts");
        let remote_allowlist_source = remote_runtime
            .split("const REMOTE_COMMANDS = new Set([")
            .nth(1)
            .and_then(|rest| rest.split("]);").next())
            .expect("remote command allowlist should be parseable");
        let remote_allowlist = quoted_commands(remote_allowlist_source);

        let dispatch_match_source = dispatch_match_source();
        let dispatch_commands = dispatch_arm_commands(dispatch_match_source);

        assert_eq!(remote_allowlist, expected_remote);
        assert_eq!(dispatch_commands, remote_allowlist);
    }

    #[test]
    fn remote_storage_dispatch_uses_blocking_worker() {
        let dispatch_match_source = dispatch_match_source();
        for command in BLOCKING_STORAGE_REMOTE_COMMANDS {
            let arm = dispatch_arm_source(dispatch_match_source, command)
                .unwrap_or_else(|| panic!("{command} should be present in http dispatch"));
            assert!(
                arm.contains("dispatch_blocking_http_storage"),
                "{command} should dispatch through the blocking storage worker"
            );
        }
        for arm in dispatch_match_source.split("\n        \"").skip(1) {
            let command = arm.split('"').next().unwrap_or("<unknown>");
            if !arm.contains("http_storage_dispatch::") {
                continue;
            }
            assert!(
                arm.contains("dispatch_blocking_http_storage"),
                "{command} should dispatch through the blocking storage worker"
            );
        }
    }

    #[tokio::test]
    async fn dispatch_load_url_binary_reads_managed_asset_urls() {
        let state = test_state("load-url-binary-local-asset");
        let avatar_dir = state.data_dir.join("avatars").join("characters");
        std::fs::create_dir_all(&avatar_dir).expect("avatar dir should be created");
        let avatar_path = avatar_dir.join("Avatar One.png");
        std::fs::write(&avatar_path, b"avatar-bytes").expect("avatar should be written");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "load_url_binary".to_string(),
                args: Some(json!({
                    "url": file_path_asset_url(&avatar_path),
                    "fallbackMime": "application/octet-stream"
                })),
            },
        )
        .await
        .expect("remote load_url_binary should load managed local assets");

        let base64 = result
            .get("base64")
            .and_then(Value::as_str)
            .expect("response should include base64");
        let bytes = general_purpose::STANDARD
            .decode(base64)
            .expect("base64 should decode");
        assert_eq!(bytes, b"avatar-bytes");
        assert_eq!(
            result.get("mimeType"),
            Some(&Value::String("image/png".into()))
        );
    }

    #[tokio::test]
    async fn dispatch_admin_clear_all_requires_confirmation_without_clearing_storage() {
        for (label, args) in [
            ("admin-clear-all-missing-confirm", json!({})),
            ("admin-clear-all-false-confirm", json!({ "confirm": false })),
        ] {
            let state = test_state(label);
            seed_character(&state, "character-1");

            let error = dispatch(
                &state,
                InvokeRequest {
                    command: "admin_clear_all_command".to_string(),
                    args: Some(args),
                },
            )
            .await
            .expect_err("remote clear all should reject missing or false confirmation");

            assert_eq!(error.code, "invalid_input");
            assert!(error.message.contains("confirm must be true"));
            assert!(character_exists(&state, "character-1"));
        }
    }

    #[tokio::test]
    async fn dispatch_admin_clear_all_clears_storage_when_confirmed() {
        let state = test_state("admin-clear-all-confirmed");
        seed_character(&state, "character-1");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "admin_clear_all_command".to_string(),
                args: Some(json!({ "confirm": true })),
            },
        )
        .await
        .expect("remote clear all should accept explicit confirmation");

        assert_eq!(result["success"], true);
        assert_eq!(result["cleared"], "all");
        assert!(!character_exists(&state, "character-1"));
    }

    #[tokio::test]
    async fn dispatch_connection_default_parameters_validate_and_mask() {
        let state = test_state("connection-default-parameters");
        state
            .storage
            .create(
                "connections",
                json!({
                    "id": "language-a",
                    "name": "Language A",
                    "provider": "openai",
                    "apiKeyEncrypted": "stored-secret",
                    "apiKeyHash": "stored-hash",
                    "apiKeyMasked": "stored-mask",
                    "defaultParameters": null
                }),
            )
            .expect("connection should seed");

        let updated = dispatch(
            &state,
            InvokeRequest {
                command: "connection_save_default_parameters".to_string(),
                args: Some(json!({
                    "id": "language-a",
                    "params": {
                        "temperature": 0.4
                    }
                })),
            },
        )
        .await
        .expect("remote default parameter save should dispatch");

        assert_eq!(updated["defaultParameters"], json!({ "temperature": 0.4 }));
        assert_eq!(updated["hasApiKey"], json!(true));
        assert_eq!(updated["apiKey"], json!(connection_secrets::API_KEY_MASK));
        assert!(updated.get("apiKeyEncrypted").is_none());
        assert!(updated.get("apiKeyHash").is_none());
        assert!(updated.get("apiKeyMasked").is_none());

        let cleared = dispatch(
            &state,
            InvokeRequest {
                command: "connection_save_default_parameters".to_string(),
                args: Some(json!({
                    "id": "language-a",
                    "params": null
                })),
            },
        )
        .await
        .expect("remote default parameter clear should dispatch");

        assert_eq!(cleared["defaultParameters"], Value::Null);
        assert_eq!(cleared["hasApiKey"], json!(true));
        assert_eq!(cleared["apiKey"], json!(connection_secrets::API_KEY_MASK));

        for (label, params) in [
            ("arrays", json!(["bad"])),
            ("JSON strings", json!("{\"temperature\":0.9}")),
            ("empty strings", json!("")),
            ("booleans", json!(false)),
        ] {
            let error = dispatch(
                &state,
                InvokeRequest {
                    command: "connection_save_default_parameters".to_string(),
                    args: Some(json!({
                        "id": "language-a",
                        "params": params
                    })),
                },
            )
            .await
            .unwrap_err();

            assert!(
                error
                    .to_string()
                    .contains("defaultParameters must be a JSON object or null"),
                "{label} produced unexpected error: {error}"
            );
        }
        let stored = state
            .storage
            .get("connections", "language-a")
            .expect("connection should read")
            .expect("connection should exist");
        assert_eq!(stored["defaultParameters"], Value::Null);
        assert_eq!(stored["apiKeyEncrypted"], json!("stored-secret"));
    }

    #[tokio::test]
    async fn dispatch_rejects_remote_empty_bulk_character_export() {
        let state = test_state("remote-empty-character-export");
        let error = dispatch(
            &state,
            InvokeRequest {
                command: "characters_export_bulk".to_string(),
                args: Some(json!({ "ids": ["missing-character"] })),
            },
        )
        .await
        .expect_err("remote stale bulk export IDs should fail visibly");

        assert_eq!(error.code, "not_found");
        assert!(error.message.contains("No matching"));
    }

    #[tokio::test]
    async fn dispatch_rejects_untrusted_remote_picker_selected_directory_listing() {
        let state = test_state("remote-picker-selected-listing");
        let error = dispatch(
            &state,
            InvokeRequest {
                command: "import_list_directory".to_string(),
                args: Some(json!({
                    "path": state.data_dir.to_string_lossy(),
                    "pickerSelected": true
                })),
            },
        )
        .await
        .expect_err("remote callers must not claim native picker trust");

        assert_eq!(error.code, "invalid_input");
        assert_eq!(
            error.message,
            "pickerSelected is only trusted through the native folder picker"
        );
    }

    #[tokio::test]
    async fn dispatch_supports_remote_chat_gallery_upload() {
        let state = test_state("chat-gallery-upload");
        let result = dispatch(
            &state,
            InvokeRequest {
                command: "chat_gallery_upload".to_string(),
                args: Some(json!({
                    "chatId": "chat-1",
                    "body": upload_body("chat-image.png")
                })),
            },
        )
        .await
        .expect("remote chat gallery upload should dispatch");

        assert_eq!(result.get("chatId").and_then(Value::as_str), Some("chat-1"));
        assert_eq!(
            result.get("filename").and_then(Value::as_str),
            Some("chat-image.png")
        );
        assert!(!result
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|url| url.starts_with("data:image/png;base64,")));
        assert!(state
            .data_dir
            .join("gallery")
            .join("chat-image.png")
            .exists());
    }

    #[tokio::test]
    async fn dispatch_supports_remote_character_gallery_upload() {
        let state = test_state("character-gallery-upload");
        seed_character(&state, "character-1");
        let result = dispatch(
            &state,
            InvokeRequest {
                command: "character_gallery_upload".to_string(),
                args: Some(json!({
                    "characterId": "character-1",
                    "body": upload_body("character-image.png")
                })),
            },
        )
        .await
        .expect("remote character gallery upload should dispatch");

        assert_eq!(
            result.get("characterId").and_then(Value::as_str),
            Some("character-1")
        );
        assert_eq!(
            result.get("filename").and_then(Value::as_str),
            Some("character-image.png")
        );
        assert!(!result
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|url| url.starts_with("data:image/png;base64,")));
        assert!(state
            .data_dir
            .join("gallery")
            .join("character-image.png")
            .exists());
    }

    #[tokio::test]
    async fn dispatch_rejects_remote_character_gallery_upload_for_missing_character() {
        let state = test_state("missing-character-gallery-upload");
        let error = dispatch(
            &state,
            InvokeRequest {
                command: "character_gallery_upload".to_string(),
                args: Some(json!({
                    "characterId": "missing-character",
                    "body": upload_body("orphan-image.png")
                })),
            },
        )
        .await
        .expect_err("missing character gallery upload should reject before writing files");

        assert_eq!(error.code, "not_found");
        assert!(state
            .storage
            .list("character-gallery")
            .expect("character gallery rows should be readable")
            .is_empty());
        assert!(
            !state.data_dir.join("gallery").exists(),
            "missing character uploads must not write managed gallery files"
        );
    }

    #[tokio::test]
    async fn dispatch_exposes_real_remote_image_generation_commands() {
        for command in [
            "image_generate",
            "avatar_generation_command",
            "sprite_generate_sheet",
            "sprite_generate_sheet_preview",
        ] {
            let state = test_state(command);
            let error = dispatch(
                &state,
                InvokeRequest {
                    command: command.to_string(),
                    args: Some(json!({ "body": {} })),
                },
            )
            .await
            .expect_err("command should dispatch into validation, not remote unsupported");

            assert_ne!(
                error.code, "unsupported_command",
                "{command} was not dispatched"
            );
            assert_eq!(
                error.code, "invalid_input",
                "{command} should reject the empty body"
            );
        }
    }

    #[tokio::test]
    async fn dispatch_supports_remote_background_upload() {
        let state = test_state("background-upload");
        let result = dispatch(
            &state,
            InvokeRequest {
                command: "background_upload".to_string(),
                args: Some(json!({ "body": upload_body("background.png") })),
            },
        )
        .await
        .expect("remote background upload should dispatch");

        assert_eq!(result.get("success").and_then(Value::as_bool), Some(true));
        assert_eq!(
            result.get("originalName").and_then(Value::as_str),
            Some("background.png")
        );
    }

    #[tokio::test]
    async fn dispatch_normalizes_remote_background_tag_updates() {
        let state = test_state("background-tag-update");
        std::fs::write(state.backgrounds.root().join("background.png"), b"png")
            .expect("background fixture should be written");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "background_tags_update".to_string(),
                args: Some(json!({
                    "filename": "background.png",
                    "tags": [
                        "  Cozy Forest!!  ",
                        "cozy forest",
                        "Castle-01",
                        "bad/tag",
                        "",
                        "abcdefghijklmnopqrstuvwxyzabcdefghijklmno"
                    ]
                })),
            },
        )
        .await
        .expect("remote background tag update should dispatch");

        assert_eq!(
            result.get("tags").cloned(),
            Some(json!(["cozy forest", "castle-01", "badtag"]))
        );
        let row = state
            .storage
            .list("background-metadata")
            .expect("metadata should list")
            .into_iter()
            .next()
            .expect("metadata should be created");
        assert_eq!(row.get("tags").cloned(), result.get("tags").cloned());
    }

    #[tokio::test]
    async fn dispatch_rejects_invalid_managed_thumbnail_size_arguments() {
        let state = test_state("managed-thumbnail-size");
        let error = dispatch(
            &state,
            InvokeRequest {
                command: "managed_asset_thumbnail_file_path".to_string(),
                args: Some(json!({
                    "kind": "gallery",
                    "path": "scene.png",
                    "size": "256"
                })),
            },
        )
        .await
        .expect_err("invalid size should be rejected before command defaults");

        assert_eq!(error.code, "invalid_input");
        assert!(
            error.message.contains("size"),
            "size validation error should mention size"
        );
    }

    #[tokio::test]
    async fn dispatch_accepts_empty_remote_game_asset_text_content() {
        let state = test_state("remote-empty-game-asset-text");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "game_assets_write_text".to_string(),
                args: Some(json!({
                    "path": "notes/blank.md",
                    "content": ""
                })),
            },
        )
        .await
        .expect("empty text content should be a valid remote asset save");

        assert_eq!(result["saved"], true);
        assert_eq!(
            state
                .game_assets
                .read_text("notes/blank.md")
                .expect("blank asset should be readable"),
            ""
        );

        let error = dispatch(
            &state,
            InvokeRequest {
                command: "game_assets_write_text".to_string(),
                args: Some(json!({
                    "path": "notes/missing-content.md"
                })),
            },
        )
        .await
        .expect_err("missing content should still be invalid");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("content"));
    }

    #[tokio::test]
    async fn dispatch_accepts_empty_remote_game_asset_folder_description() {
        let state = test_state("remote-empty-game-asset-description");
        state
            .game_assets
            .create_folder("locations")
            .expect("locations folder should exist before clearing metadata");
        state
            .game_assets
            .set_folder_description("locations", "Known places")
            .expect("locations folder description should be seeded");

        let result = dispatch(
            &state,
            InvokeRequest {
                command: "game_assets_folder_description".to_string(),
                args: Some(json!({
                    "path": "locations",
                    "description": ""
                })),
            },
        )
        .await
        .expect("empty folder description should clear remote metadata");

        assert_eq!(result["path"], "locations");
        assert_eq!(result["description"], "");

        let tree = state
            .game_assets
            .tree()
            .expect("asset tree should be readable");
        let locations = tree["children"]
            .as_array()
            .expect("tree children should be an array")
            .iter()
            .find(|item| item.get("path").and_then(Value::as_str) == Some("locations"))
            .expect("locations folder should exist");
        assert!(locations.get("description").is_none());

        let error = dispatch(
            &state,
            InvokeRequest {
                command: "game_assets_folder_description".to_string(),
                args: Some(json!({
                    "path": "",
                    "description": ""
                })),
            },
        )
        .await
        .expect_err("empty path should still be invalid");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("path"));
    }

    #[tokio::test]
    async fn dispatch_game_asset_mutations_clear_managed_game_thumbnails() {
        for (label, command, args) in [
            (
                "delete-file",
                "game_assets_delete_file",
                json!({ "path": "sprites/delete-file.png" }),
            ),
            (
                "rename",
                "game_assets_rename",
                json!({ "path": "sprites/rename.png", "newName": "renamed.png" }),
            ),
            (
                "move",
                "game_assets_move",
                json!({ "path": "sprites/move.png", "targetFolder": "backgrounds" }),
            ),
            (
                "delete-bulk",
                "game_assets_delete_bulk",
                json!({ "paths": ["sprites/delete-bulk.png"] }),
            ),
            (
                "move-bulk",
                "game_assets_move_bulk",
                json!({ "paths": ["sprites/move-bulk.png"], "targetFolder": "backgrounds" }),
            ),
        ] {
            let state = test_state(label);
            let path = args
                .get("path")
                .and_then(Value::as_str)
                .or_else(|| {
                    args.get("paths")
                        .and_then(Value::as_array)
                        .and_then(|paths| paths.first())
                        .and_then(Value::as_str)
                })
                .expect("test args should include a source path");
            write_game_asset_png(&state, path);
            let thumbnail = create_remote_game_thumbnail(&state, path).await;

            dispatch(
                &state,
                InvokeRequest {
                    command: command.to_string(),
                    args: Some(args),
                },
            )
            .await
            .expect("remote game asset mutation should dispatch");

            assert!(
                !thumbnail.exists(),
                "{command} should remove managed game thumbnail {}",
                thumbnail.display()
            );
        }
    }

    #[tokio::test]
    async fn dispatch_failed_game_asset_rename_keeps_managed_game_thumbnail() {
        for (label, command, args) in [
            (
                "failed-rename-thumbnail",
                "game_assets_rename",
                json!({ "path": "sprites/failed-rename.png", "newName": "../renamed.png" }),
            ),
            (
                "failed-move-thumbnail",
                "game_assets_move",
                json!({ "path": "sprites/failed-move.png", "targetFolder": "../outside" }),
            ),
        ] {
            let state = test_state(label);
            let path = args
                .get("path")
                .and_then(Value::as_str)
                .expect("test args should include a source path")
                .to_string();
            write_game_asset_png(&state, &path);
            let thumbnail = create_remote_game_thumbnail(&state, &path).await;

            let error = dispatch(
                &state,
                InvokeRequest {
                    command: command.to_string(),
                    args: Some(args),
                },
            )
            .await
            .expect_err("invalid mutation should fail");

            assert_eq!(error.code, "invalid_input");
            assert!(
                thumbnail.is_file(),
                "{command} failure should keep managed game thumbnail {}",
                thumbnail.display()
            );
            assert!(
                PathBuf::from(
                    state
                        .game_assets
                        .absolute_path_string(&path)
                        .expect("original asset path should be valid")
                )
                .is_file(),
                "{command} failure should leave the original asset in place"
            );
        }
    }

    #[tokio::test]
    async fn dispatch_bulk_game_asset_mutations_clear_only_succeeded_thumbnails() {
        for (label, command, args, succeeded_path, failed_path) in [
            (
                "delete-bulk-partial",
                "game_assets_delete_bulk",
                json!({ "paths": ["sprites/delete-bulk-ok.png", "sprites"] }),
                "sprites/delete-bulk-ok.png",
                "sprites/delete-bulk-failed.png",
            ),
            (
                "move-bulk-partial",
                "game_assets_move_bulk",
                json!({
                    "paths": ["sprites/move-bulk-ok.png", "missing/move-bulk-failed.png"],
                    "targetFolder": "backgrounds"
                }),
                "sprites/move-bulk-ok.png",
                "sprites/move-bulk-failed.png",
            ),
        ] {
            let state = test_state(label);
            write_game_asset_png(&state, succeeded_path);
            write_game_asset_png(&state, failed_path);
            let succeeded_thumbnail = create_remote_game_thumbnail(&state, succeeded_path).await;
            let failed_thumbnail = create_remote_game_thumbnail(&state, failed_path).await;

            let result = dispatch(
                &state,
                InvokeRequest {
                    command: command.to_string(),
                    args: Some(args),
                },
            )
            .await
            .expect("bulk mutation should return a partial result");

            assert_eq!(
                result
                    .get("succeeded")
                    .and_then(Value::as_array)
                    .map(Vec::len),
                Some(1),
                "{command} should report one succeeded path"
            );
            assert_eq!(
                result.get("failed").and_then(Value::as_array).map(Vec::len),
                Some(1),
                "{command} should report one failed path"
            );
            assert!(
                !succeeded_thumbnail.exists(),
                "{command} should clear the succeeded thumbnail {}",
                succeeded_thumbnail.display()
            );
            assert!(
                failed_thumbnail.is_file(),
                "{command} should keep the failed thumbnail {}",
                failed_thumbnail.display()
            );
        }
    }

    #[tokio::test]
    async fn dispatch_rejects_invalid_avatar_thumbnail_size_arguments() {
        let state = test_state("avatar-thumbnail-size");
        let avatar_dir = state.data_dir.join("avatars").join("characters");
        std::fs::create_dir_all(&avatar_dir).expect("avatar dir should be created");
        let avatar_path = avatar_dir.join("source.png");
        image::RgbaImage::from_pixel(32, 32, image::Rgba([255, 0, 0, 255]))
            .save(&avatar_path)
            .expect("avatar fixture should write");

        let error = dispatch(
            &state,
            InvokeRequest {
                command: "avatar_thumbnail_file_path".to_string(),
                args: Some(json!({
                    "absolutePath": avatar_path.to_string_lossy(),
                    "size": "256"
                })),
            },
        )
        .await
        .expect_err("invalid size should be rejected before avatar command defaults");

        assert_eq!(error.code, "invalid_input");
        assert!(
            error.message.contains("size"),
            "size validation error should mention size"
        );
    }

    #[tokio::test]
    async fn dispatch_rejects_remote_raw_server_path_commands() {
        for (command, args) in [
            (
                "background_file_path",
                json!({ "filename": "background.png" }),
            ),
            (
                "game_assets_file_path",
                json!({ "path": "folder/asset.png" }),
            ),
            ("gallery_file_path", json!({ "filename": "gallery.png" })),
            (
                "lorebook_image_file_path",
                json!({ "filename": "image.png" }),
            ),
        ] {
            let state = test_state(command);
            let error = dispatch(
                &state,
                InvokeRequest {
                    command: command.to_string(),
                    args: Some(args),
                },
            )
            .await
            .expect_err("raw server file paths should not be exposed remotely");

            assert_eq!(error.code, "unsupported_command");
        }
    }

    #[tokio::test]
    async fn dispatch_supports_remote_update_apply_manual_path() {
        let state = test_state("update-apply");
        let result = dispatch(
            &state,
            InvokeRequest {
                command: "update_apply".to_string(),
                args: Some(json!({
                    "input": {
                        "confirm": true,
                        "latestVersion": "1.6.2",
                        "releaseTag": "v1.6.2",
                        "releaseUrl": "https://github.com/The-Koi-Pond/De-Koi/releases/tag/v1.6.2"
                    }
                })),
            },
        )
        .await
        .expect("remote update apply should dispatch into manual release instructions");

        assert_eq!(result["status"], "manual_update_required");
        assert_eq!(result["applyAvailable"], false);
        assert_eq!(
            result["applyUnavailableReason"],
            "tauri-updater-not-configured"
        );
    }
}
