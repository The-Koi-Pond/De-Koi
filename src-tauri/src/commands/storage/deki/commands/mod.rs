use super::protocol::DekiCommandRequest;
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Value};

pub(super) mod code;
pub(super) mod web;

#[derive(Debug, Clone)]
pub(super) struct DekiCommandExecution {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) trace_name: String,
    pub(super) args: Value,
    pub(super) ok: bool,
    pub(super) output: Value,
}

#[derive(Debug, Clone)]
pub(super) struct DekiCommandTurnState {
    web_pages_read: usize,
    max_web_pages_per_turn: usize,
}

impl DekiCommandTurnState {
    pub(super) fn new(max_web_pages_per_turn: usize) -> Self {
        Self {
            web_pages_read: 0,
            max_web_pages_per_turn,
        }
    }

    fn reserve_web_page_read(&mut self) -> AppResult<()> {
        if self.web_pages_read >= self.max_web_pages_per_turn {
            return Err(AppError::new(
                "deki_web_page_turn_limit",
                format!(
                    "Deki-senpai already read {} web page(s) this turn. Narrow the next search or ask to continue before reading more pages.",
                    self.max_web_pages_per_turn
                ),
            ));
        }
        self.web_pages_read += 1;
        Ok(())
    }
}

enum DekiCommand {
    Read(code::ReadRepoFileArgs),
    Grep(code::SearchTextArgs),
    Find(code::FindRepoPathArgs),
    Ls(code::ListRepoPathArgs),
    ReadLibrary(super::ReadDekiLibraryArgs),
    ReadLibraryItems(super::ReadDekiLibraryItemsArgs),
    DekiCode(code::DekiCodeCommand),
    SearchCode(code::SearchTextArgs),
    ReadCodeFile(code::ReadDekiCodeFileArgs),
    ReadChats(super::chat_access::ReadDekiChatsArgs),
    ReadChatMessages(super::chat_access::ReadDekiChatMessagesArgs),
    SearchWeb(web::SearchDekiWebArgs),
    ReadWebPage(web::ReadDekiWebPageArgs),
}

impl DekiCommand {
    fn parse(name: &str, args: Value) -> AppResult<Self> {
        match name {
            "read" => parse_command_args("read", args).map(Self::Read),
            "grep" => parse_command_args("grep", args).map(Self::Grep),
            "find" => parse_command_args("find", args).map(Self::Find),
            "ls" => parse_command_args("ls", args).map(Self::Ls),
            "deki_data" | "read_deki_library" => {
                parse_command_args("read_deki_library", args).map(Self::ReadLibrary)
            }
            "read_deki_library_items" => {
                parse_command_args("read_deki_library_items", args).map(Self::ReadLibraryItems)
            }
            "deki_code" => code::parse_deki_code_command(args).map(Self::DekiCode),
            "search_deki_code" => {
                parse_command_args("search_deki_code", args).map(Self::SearchCode)
            }
            "read_deki_code_file" => {
                parse_command_args("read_deki_code_file", args).map(Self::ReadCodeFile)
            }
            "read_deki_chats" => parse_command_args("read_deki_chats", args).map(Self::ReadChats),
            "read_deki_chat_messages" => {
                parse_command_args("read_deki_chat_messages", args).map(Self::ReadChatMessages)
            }
            "search_deki_web" => parse_command_args("search_deki_web", args).map(Self::SearchWeb),
            "read_deki_web_page" => {
                parse_command_args("read_deki_web_page", args).map(Self::ReadWebPage)
            }
            _ => Err(AppError::invalid_input(format!(
                "Deki-senpai command '{name}' is not available in the read-only JSON runtime."
            ))),
        }
    }
}

pub(super) async fn execute(
    id: String,
    state: &AppState,
    chat_access_grants: &[super::chat_access::DekiChatAccessGrant],
    web_research_grants: &[web::DekiWebResearchGrant],
    turn_state: &mut DekiCommandTurnState,
    request: DekiCommandRequest,
) -> DekiCommandExecution {
    let name = normalized_command_name(&request.name);
    let trace_name = trace_tool_name(&name).to_string();
    let args = request.args;
    let output = match DekiCommand::parse(&name, args.clone()) {
        Ok(command) => {
            run_command(
                command,
                state,
                chat_access_grants,
                web_research_grants,
                turn_state,
            )
            .await
        }
        Err(error) => Err(error),
    };
    match output {
        Ok(output) => DekiCommandExecution {
            id,
            name,
            trace_name,
            args,
            ok: true,
            output,
        },
        Err(error) => DekiCommandExecution {
            id,
            name,
            trace_name,
            args,
            ok: false,
            output: json!({
                "code": error.code,
                "message": error.message,
            }),
        },
    }
}

impl DekiCommandExecution {
    pub(super) fn evidence_value(&self) -> Value {
        if self.ok {
            json!({
                "id": self.id,
                "name": self.name,
                "ok": true,
                "output": self.output,
            })
        } else {
            json!({
                "id": self.id,
                "name": self.name,
                "ok": false,
                "error": self.output,
            })
        }
    }
}

async fn run_command(
    command: DekiCommand,
    state: &AppState,
    chat_access_grants: &[super::chat_access::DekiChatAccessGrant],
    web_research_grants: &[web::DekiWebResearchGrant],
    turn_state: &mut DekiCommandTurnState,
) -> AppResult<Value> {
    match command {
        DekiCommand::Read(args) => code::read_repo_file(args),
        DekiCommand::Grep(args) | DekiCommand::SearchCode(args) => code::search_code(args),
        DekiCommand::Find(args) => code::find_repo_paths(args),
        DekiCommand::Ls(args) => code::list_repo_path(args),
        DekiCommand::ReadLibrary(args) => read_deki_library(state, args),
        DekiCommand::ReadLibraryItems(args) => read_deki_library_items(state, args),
        DekiCommand::DekiCode(code::DekiCodeCommand::Search(args)) => code::search_code(args),
        DekiCommand::DekiCode(code::DekiCodeCommand::Read(args)) => code::read_deki_code_file(args),
        DekiCommand::ReadCodeFile(args) => code::read_deki_code_file(args),
        DekiCommand::ReadChats(args) => read_deki_chats(state, chat_access_grants, args),
        DekiCommand::ReadChatMessages(args) => {
            read_deki_chat_messages(state, chat_access_grants, args)
        }
        DekiCommand::SearchWeb(args) => search_deki_web(web_research_grants, args).await,
        DekiCommand::ReadWebPage(args) => {
            turn_state.reserve_web_page_read()?;
            read_deki_web_page(web_research_grants, args).await
        }
    }
}

fn parse_command_args<T>(command_name: &str, args: Value) -> AppResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(args).map_err(|error| {
        AppError::invalid_input(format!("{command_name} args are invalid: {error}"))
    })
}

fn read_deki_library(state: &AppState, args: super::ReadDekiLibraryArgs) -> AppResult<Value> {
    super::library::overview(
        state,
        super::library::LibraryOverviewQuery {
            item_type: args.item_type,
            types: super::parse_deki_library_types(args.types.as_deref()),
            query: args.query,
            limit: args.limit,
            offset: args.offset,
        },
    )
}

fn read_deki_library_items(
    state: &AppState,
    args: super::ReadDekiLibraryItemsArgs,
) -> AppResult<Value> {
    super::library::items(
        state,
        vec![super::library::LibraryItemRequest {
            item_type: args.item_type,
            id: args.id,
            include_entries: args.include_entries,
            entry_query: args.entry_query,
            entry_limit: args.entry_limit,
            entry_offset: args.entry_offset,
        }],
    )
}

fn read_deki_chats(
    state: &AppState,
    grants: &[super::chat_access::DekiChatAccessGrant],
    args: super::chat_access::ReadDekiChatsArgs,
) -> AppResult<Value> {
    super::chat_access::overview(state, grants, args)
}

fn read_deki_chat_messages(
    state: &AppState,
    grants: &[super::chat_access::DekiChatAccessGrant],
    args: super::chat_access::ReadDekiChatMessagesArgs,
) -> AppResult<Value> {
    super::chat_access::messages(state, grants, args)
}

async fn search_deki_web(
    grants: &[web::DekiWebResearchGrant],
    args: web::SearchDekiWebArgs,
) -> AppResult<Value> {
    web::search_deki_web(args, grants).await
}

async fn read_deki_web_page(
    grants: &[web::DekiWebResearchGrant],
    args: web::ReadDekiWebPageArgs,
) -> AppResult<Value> {
    web::read_deki_web_page(args, grants).await
}

fn normalized_command_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

fn trace_tool_name(name: &str) -> &str {
    match name {
        "read"
        | "grep"
        | "find"
        | "ls"
        | "deki_data"
        | "deki_code"
        | "read_deki_library"
        | "read_deki_library_items"
        | "search_deki_code"
        | "read_deki_code_file"
        | "read_deki_chats"
        | "read_deki_chat_messages"
        | "search_deki_web"
        | "read_deki_web_page" => name,
        _ => "deki_code",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn web_page_turn_state_rejects_reads_after_limit() {
        let mut state = DekiCommandTurnState::new(2);

        state
            .reserve_web_page_read()
            .expect("first page read should fit");
        state
            .reserve_web_page_read()
            .expect("second page read should fit");
        let error = state
            .reserve_web_page_read()
            .expect_err("third page read should exceed the turn limit");

        assert_eq!(error.code, "deki_web_page_turn_limit");
        assert!(error.message.contains("2 web page"));
    }

    #[test]
    fn deki_code_command_selects_search_when_query_is_present() {
        let command = code::parse_deki_code_command(json!({ "query": "AppShell" }))
            .expect("query command should parse");

        assert!(matches!(command, code::DekiCodeCommand::Search(_)));
    }
}
