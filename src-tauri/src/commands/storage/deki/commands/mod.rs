use super::approvals::DekiApprovalScope;
use super::data_cli;
use super::protocol::DekiCommandRequest;
use crate::state::AppState;
use marinara_core::{AppError, AppResult};
use serde::Deserialize;
use serde_json::{json, Value};

pub(super) mod code;
pub(super) mod web;

pub(super) const JSON_COMMAND_GUIDE: &str = r#"Deki command argument contracts (all paths are repository-relative and all keys use camelCase):
- read: {"path":"relative/file"}
- grep: {"query":"text","path":"optional/file-or-directory","maxResults":32,"contextLines":0}
- find: {"query":"name","path":"optional/directory","maxResults":80}
- ls: {"path":"relative/directory","limit":80}
- deki_code: either {"path":"relative/file"} or {"query":"text","path":"optional/file-or-directory","maxResults":32,"contextLines":0}
- search_deki_code: {"query":"text","path":"optional/file-or-directory","maxResults":32,"contextLines":0}
- read_deki_code_file: {"path":"relative/file"}
- read_deki_library: {"itemType":"optional type","types":"optional comma-separated types","query":"optional text","limit":80,"offset":0}
- read_deki_library_items: {"itemType":"type","id":"exact id","includeEntries":true,"entryQuery":"optional text","entryLimit":50,"entryOffset":0}
- read_deki_chats: {"chatIds":["optional approved id"],"characterId":"optional id","modes":["conversation"],"limit":50,"offset":0}
- read_deki_chat_messages: {"chatId":"approved id","limit":50,"before":"optional createdAt|id cursor"}
- read_deki_memories: {"scopeType":"character or chat","scopeId":"exact id","query":"optional text","limit":50}
- search_deki_web: {"query":"exact approved query","maxResults":5}
- read_deki_web_page: {"query":"exact approved query","url":"approved public result URL"}
Omit optional keys you do not need. Prefer precise searches over reading a large file from its beginning: large reads can truncate before a deep symbol, while grep/search results include matching line numbers and previews. Set contextLines to 1-3 when adjacent lines are needed to verify a call, signature, condition, or payload; keep it 0 otherwise. When the task names several exact files, search those exact file paths rather than a parent directory, and batch up to four independent query/path pairs in one frame. Continue until every user-requested query has returned evidence or a demonstrated no-match result. Never repeat an identical command after it succeeded. A search result proves only its returned path, line, preview, and requested context: copy exact symbols, signatures, and line numbers only when that text is visible in successful evidence, and never reconstruct omitted text. Say what could not be verified instead of guessing. After evidence answers the task, return commands:[] and stop:true."#;

pub(super) fn is_repository_command(name: &str) -> bool {
    matches!(
        normalized_command_name(name).as_str(),
        "read" | "grep" | "find" | "ls" | "deki_code" | "search_deki_code" | "read_deki_code_file"
    )
}

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
    data_mutations: usize,
    max_data_mutations_per_turn: usize,
    pending_approvals: Vec<Value>,
}

impl DekiCommandTurnState {
    pub(super) fn new(max_web_pages_per_turn: usize, max_data_mutations_per_turn: usize) -> Self {
        Self {
            web_pages_read: 0,
            max_web_pages_per_turn,
            data_mutations: 0,
            max_data_mutations_per_turn,
            pending_approvals: Vec::new(),
        }
    }

    pub(super) fn pending_approval_count(&self) -> usize {
        self.pending_approvals.len()
    }

    pub(super) fn pending_approvals_since(&self, start: usize) -> &[Value] {
        self.pending_approvals.get(start..).unwrap_or_default()
    }

    /// Pending approvals created by `deki_data` dry-runs during this turn.
    pub(super) fn take_pending_approvals(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.pending_approvals)
    }

    fn reserve_data_mutation(&mut self) -> AppResult<()> {
        if self.data_mutations >= self.max_data_mutations_per_turn {
            return Err(AppError::new(
                "deki_data_turn_limit",
                format!(
                    "Deki-senpai already proposed {} data changes this turn. Let the user review them before proposing more.",
                    self.max_data_mutations_per_turn
                ),
            ));
        }
        self.data_mutations += 1;
        Ok(())
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
    Data(data_cli::DekiDataCommand),
    ReadLibrary(super::ReadDekiLibraryArgs),
    ReadLibraryItems(super::ReadDekiLibraryItemsArgs),
    DekiCode(code::DekiCodeCommand),
    SearchCode(code::SearchTextArgs),
    ReadCodeFile(code::ReadDekiCodeFileArgs),
    ReadChats(super::chat_access::ReadDekiChatsArgs),
    ReadChatMessages(super::chat_access::ReadDekiChatMessagesArgs),
    ReadMemories(super::memory_access::ReadDekiMemoriesArgs),
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
            "deki_data" => data_cli::parse(args).map(Self::Data),
            "read_deki_library" => {
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
            "read_deki_memories" => {
                parse_command_args("read_deki_memories", args).map(Self::ReadMemories)
            }
            "search_deki_web" => parse_command_args("search_deki_web", args).map(Self::SearchWeb),
            "read_deki_web_page" => {
                parse_command_args("read_deki_web_page", args).map(Self::ReadWebPage)
            }
            _ => Err(AppError::invalid_input(format!(
                "Deki-senpai command '{name}' is not available in the JSON command runtime."
            ))),
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct DekiCommandContext<'a> {
    pub(super) state: &'a AppState,
    pub(super) approval_scope: &'a DekiApprovalScope,
    pub(super) chat_access_grants: &'a [super::chat_access::DekiChatAccessGrant],
    pub(super) web_research_grants: &'a [web::DekiWebResearchGrant],
}

pub(super) async fn execute(
    id: String,
    context: DekiCommandContext<'_>,
    turn_state: &mut DekiCommandTurnState,
    request: DekiCommandRequest,
) -> DekiCommandExecution {
    let name = normalized_command_name(&request.name);
    let trace_name = trace_tool_name(&name).to_string();
    let args = request.args;
    let output = match DekiCommand::parse(&name, args.clone()) {
        Ok(command) => run_command(command, context, turn_state).await,
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
    context: DekiCommandContext<'_>,
    turn_state: &mut DekiCommandTurnState,
) -> AppResult<Value> {
    let DekiCommandContext {
        state,
        approval_scope,
        chat_access_grants,
        web_research_grants,
    } = context;
    match command {
        DekiCommand::Data(command) => {
            if command.is_mutation() {
                turn_state.reserve_data_mutation()?;
            }
            data_cli::execute(
                state,
                approval_scope,
                command,
                &mut turn_state.pending_approvals,
            )
        }
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
        DekiCommand::ReadMemories(args) => {
            super::memory_access::read(state, chat_access_grants, args)
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

/// The user-facing tool name for a requested command, as used in traces and
/// live events.
pub(super) fn display_name(name: &str) -> String {
    trace_tool_name(&normalized_command_name(name)).to_string()
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
        | "read_deki_memories"
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
        let mut state = DekiCommandTurnState::new(2, 4);

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

    #[test]
    fn deki_code_command_rejects_malformed_search_discriminators() {
        for args in [
            json!({ "query": 123, "path": "src/app/App.tsx" }),
            json!({ "query": "   ", "path": "src/app/App.tsx" }),
            json!({ "pattern": false, "path": "src/app/App.tsx" }),
        ] {
            let error = match code::parse_deki_code_command(args) {
                Err(error) => error,
                Ok(_) => panic!("present-but-invalid search fields must fail closed"),
            };

            assert_eq!(error.code, "invalid_input");
        }
    }

    #[test]
    fn json_command_guide_documents_repository_argument_contracts() {
        assert!(JSON_COMMAND_GUIDE.contains(r#"read: {"path":"relative/file"}"#));
        assert!(JSON_COMMAND_GUIDE.contains(r#"grep: {"query":"text""#));
        assert!(JSON_COMMAND_GUIDE.contains(r#"find: {"query":"name""#));
        assert!(JSON_COMMAND_GUIDE.contains(r#"ls: {"path":"relative/directory""#));
        assert!(JSON_COMMAND_GUIDE.contains(r#"read_deki_code_file: {"path":"relative/file"}"#));
        assert!(JSON_COMMAND_GUIDE.contains(r#"search_deki_code: {"query":"text""#));
        assert!(JSON_COMMAND_GUIDE.contains(r#""contextLines":0"#));
        assert!(JSON_COMMAND_GUIDE.contains("Set contextLines to 1-3"));
        assert!(JSON_COMMAND_GUIDE.contains("search those exact file paths"));
        assert!(JSON_COMMAND_GUIDE
            .contains("proves only its returned path, line, preview, and requested context"));
        assert!(JSON_COMMAND_GUIDE.contains("never reconstruct omitted text"));
    }

    #[test]
    fn web_search_command_accepts_the_documented_camel_case_limit() {
        let command = DekiCommand::parse(
            "search_deki_web",
            json!({ "query": "De-Koi", "maxResults": 3 }),
        )
        .expect("documented web search args should parse");

        assert!(matches!(command, DekiCommand::SearchWeb(_)));
    }

    #[test]
    fn data_mutations_are_capped_per_turn() {
        let mut state = DekiCommandTurnState::new(2, 1);

        state
            .reserve_data_mutation()
            .expect("first data change should fit");
        let error = state
            .reserve_data_mutation()
            .expect_err("second data change should exceed the turn limit");

        assert_eq!(error.code, "deki_data_turn_limit");
    }

    #[test]
    fn deki_data_requires_an_action_instead_of_aliasing_library_reads() {
        assert!(DekiCommand::parse("deki_data", json!({ "itemType": "character" })).is_err());
        assert!(matches!(
            DekiCommand::parse(
                "deki_data",
                json!({ "action": "list", "collection": "characters" })
            ),
            Ok(DekiCommand::Data(_))
        ));
    }

    #[test]
    fn repository_command_classification_covers_only_codebase_reads() {
        assert!(is_repository_command("grep"));
        assert!(is_repository_command("READ_DEKI_CODE_FILE"));
        assert!(!is_repository_command("read_deki_library"));
        assert!(!is_repository_command("search_deki_web"));
    }
}
