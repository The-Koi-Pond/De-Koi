//! Character Card V3 JSON and CHARX package writers.
//!
//! Both formats start from one portable V3 card built from the stored
//! character. The card carries the current character fields, the linked
//! lorebook as `character_book`, and standards-mapped assets. Runtime-only
//! data (record ids, import pointers, local file paths) never enters the card.
//! Anything that cannot be represented is listed in the export report instead
//! of being dropped silently.

use super::*;
use chrono::DateTime;

/// Package limits mirror the CHARX import limits, so every package De-Koi
/// writes is one De-Koi can read back.
const CHARX_MAX_ENTRIES: usize = 512;
const CHARX_MAX_ASSET_BYTES: usize = 50 * 1024 * 1024;
const CHARX_MAX_TOTAL_BYTES: usize = 256 * 1024 * 1024;
const CHARX_SCHEME: &str = "embeded://";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum CardTarget {
    JsonV3,
    Charx,
}

impl CardTarget {
    pub(super) fn from_format(format: Option<&str>) -> Option<Self> {
        match format {
            Some("v3") => Some(Self::JsonV3),
            Some("charx") => Some(Self::Charx),
            _ => None,
        }
    }

    pub(super) fn extension(self) -> &'static str {
        match self {
            Self::JsonV3 => "json",
            Self::Charx => "charx",
        }
    }

    pub(super) fn content_type(self) -> &'static str {
        match self {
            Self::JsonV3 => "application/json",
            Self::Charx => "application/zip",
        }
    }
}

/// What an export included and what it could not represent.
#[derive(Default)]
pub(super) struct ExportReport {
    included: Vec<Value>,
    skipped: Vec<Value>,
}

impl ExportReport {
    fn include(&mut self, character: &str, asset: impl Into<String>) {
        self.included
            .push(json!({ "character": character, "asset": asset.into() }));
    }

    fn skip(&mut self, character: &str, asset: impl Into<String>, reason: impl Into<String>) {
        self.skipped.push(json!({
            "character": character,
            "asset": asset.into(),
            "reason": reason.into(),
        }));
    }

    pub(super) fn merge(&mut self, other: ExportReport) {
        self.included.extend(other.included);
        self.skipped.extend(other.skipped);
    }

    pub(super) fn to_value(&self) -> Value {
        json!({ "included": self.included, "skipped": self.skipped })
    }
}

struct PackagedAsset {
    path: String,
    bytes: Vec<u8>,
}

pub(super) struct PortableCard {
    pub(super) name: String,
    card: Value,
    assets: Vec<PackagedAsset>,
    pub(super) report: ExportReport,
}

impl PortableCard {
    /// The file bytes for this card in its target format.
    pub(super) fn into_bytes(self, target: CardTarget) -> AppResult<(Vec<u8>, ExportReport)> {
        match target {
            CardTarget::JsonV3 => Ok((serde_json::to_vec_pretty(&self.card)?, self.report)),
            CardTarget::Charx => {
                let mut zip = ExportZip::new();
                zip.add_json("card.json", &self.card)?;
                for asset in &self.assets {
                    zip.add_bytes(&asset.path, &asset.bytes)?;
                }
                Ok((zip.finish()?, self.report))
            }
        }
    }
}

/// Builds the V3 card and, for CHARX, the asset files it references.
pub(super) fn build_portable_card(
    state: &AppState,
    character: &Value,
    target: CardTarget,
    memories_requested: bool,
) -> AppResult<PortableCard> {
    let id = record_id(character, "character")?;
    let source = character_data_value(character);
    let name = source
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Character")
        .to_string();
    let mut report = ExportReport::default();
    let mut packager = AssetPackager::new(target);
    let mut data = portable_card_fields(&source, character);

    let mut extensions = portable_extensions(&source);
    let mut assets = Vec::new();

    // Icon: the character avatar, or the spec's default-icon marker. A stored
    // avatar that cannot be read is reported rather than silently replaced.
    let avatar = avatar_data_url(state, character).and_then(|url| decode_image_data_url(&url));
    if avatar.is_none() && has_avatar_reference(character) {
        report.skip(
            &name,
            "Avatar",
            "The avatar image could not be read (missing file or unsupported format). The card uses the default icon.",
        );
    }
    match avatar {
        Some((ext, bytes)) if target == CardTarget::Charx => {
            match packager.add("assets/icon/images/main", &ext, bytes, &name, "Avatar", &mut report) {
                Some(uri) => assets.push(json!({ "type": "icon", "uri": uri, "name": "main", "ext": ext })),
                None => assets.push(default_icon()),
            }
        }
        Some(_) => {
            report.skip(
                &name,
                "Avatar",
                "V3 JSON cannot carry image files. Export CHARX or Compatible PNG to include the avatar.",
            );
            assets.push(default_icon());
        }
        None => assets.push(default_icon()),
    }

    // Profile banner: packaged under a custom asset type and referenced from
    // the publicProfile extension, which is where De-Koi reads it back.
    if let Some(banner) = take_local_banner(&mut extensions) {
        match (target, decode_image_data_url(&banner).or_else(|| banner_file_bytes(state, &banner))) {
            (CardTarget::Charx, Some((ext, bytes))) => {
                if let Some(uri) =
                    packager.add("assets/other/images/banner", &ext, bytes, &name, "Profile banner", &mut report)
                {
                    assets.push(json!({ "type": "x-banner", "uri": uri, "name": "banner", "ext": ext }));
                    set_banner(&mut extensions, &uri);
                }
            }
            (CardTarget::Charx, None) => {
                report.skip(&name, "Profile banner", "The banner image file could not be read.")
            }
            (CardTarget::JsonV3, _) => report.skip(
                &name,
                "Profile banner",
                "V3 JSON cannot carry image files. Export CHARX to include the banner.",
            ),
        }
    }

    // Expression sprites map to the standard `emotion` asset type.
    let sprites = sprites_for_owner(state, id, SpriteExportOwnerKind::Character)?;
    if !sprites.is_empty() {
        if target == CardTarget::JsonV3 {
            report.skip(
                &name,
                format!("{} expression sprite(s)", sprites.len()),
                "V3 JSON cannot carry image files. Export CHARX to include sprites.",
            );
        } else {
            let mut used_names = HashSet::new();
            for sprite in &sprites {
                let filename = sprite.get("filename").and_then(Value::as_str).unwrap_or("sprite");
                let Some((ext, bytes)) = sprite
                    .get("data")
                    .and_then(Value::as_str)
                    .and_then(decode_image_data_url)
                else {
                    report.skip(&name, format!("Sprite {filename}"), "The sprite image could not be read.");
                    continue;
                };
                let expression = Path::new(filename)
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or("sprite");
                let stem = unique_name(&safe_export_name(expression, "sprite"), &mut used_names);
                let path = format!("assets/emotion/images/{stem}");
                if let Some(uri) =
                    packager.add(&path, &ext, bytes, &name, format!("Sprite {filename}"), &mut report)
                {
                    assets.push(json!({ "type": "emotion", "uri": uri, "name": expression, "ext": ext }));
                }
            }
        }
    }

    let gallery_count = gallery_for_character(state, id)?.len();
    if gallery_count > 0 {
        report.skip(
            &name,
            format!("{gallery_count} gallery image(s)"),
            "Character cards have no gallery asset type. De-Koi Native export keeps the gallery.",
        );
    }
    if memories_requested {
        report.skip(
            &name,
            "Character memories",
            "Only De-Koi Native exports include memories.",
        );
    }

    if let Some(book) = character_book(state, id, &source)? {
        data.insert("character_book".to_string(), book);
    }
    data.insert("extensions".to_string(), Value::Object(extensions));
    data.insert("assets".to_string(), Value::Array(assets));

    Ok(PortableCard {
        name,
        card: json!({ "spec": "chara_card_v3", "spec_version": "3.0", "data": Value::Object(data) }),
        assets: packager.files,
        report,
    })
}

const V3_TEXT_FIELDS: &[&str] = &[
    "name",
    "description",
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
    "creator_notes",
    "system_prompt",
    "post_history_instructions",
    "creator",
    "character_version",
];

const V3_LIST_FIELDS: &[&str] = &["tags", "alternate_greetings", "group_only_greetings", "source"];

fn portable_card_fields(source: &Value, character: &Value) -> Map<String, Value> {
    let mut data = Map::new();
    for field in V3_TEXT_FIELDS {
        let value = source.get(*field).and_then(Value::as_str).unwrap_or("");
        data.insert(field.to_string(), json!(value));
    }
    for field in V3_LIST_FIELDS {
        let values = source
            .get(*field)
            .and_then(Value::as_array)
            .map(|items| items.iter().filter(|item| item.is_string()).cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        data.insert(field.to_string(), Value::Array(values));
    }
    if let Some(nickname) = source.get("nickname").and_then(Value::as_str).filter(|value| !value.trim().is_empty()) {
        data.insert("nickname".to_string(), json!(nickname));
    }
    if let Some(notes) = source.get("creator_notes_multilingual").filter(|value| value.is_object()) {
        data.insert("creator_notes_multilingual".to_string(), notes.clone());
    }
    for (record_field, card_field) in [("createdAt", "creation_date"), ("updatedAt", "modification_date")] {
        if let Some(seconds) = character
            .get(record_field)
            .and_then(Value::as_str)
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|date| date.timestamp())
        {
            data.insert(card_field.to_string(), json!(seconds));
        }
    }
    data
}

/// Character extensions without De-Koi's runtime-only import metadata.
fn portable_extensions(source: &Value) -> Map<String, Value> {
    let mut extensions = source
        .get("extensions")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    extensions.remove("importMetadata");
    extensions
}

/// Removes a banner that points at De-Koi storage (a data URL or a local
/// asset path) and returns it; remote URLs stay in the card as they are.
fn take_local_banner(extensions: &mut Map<String, Value>) -> Option<String> {
    let profile = extensions.get_mut("publicProfile")?.as_object_mut()?;
    let banner = profile.get("bannerImage")?.as_str()?.trim().to_string();
    if banner.is_empty() || banner.starts_with("https://") || banner.starts_with("http://") {
        return None;
    }
    profile.remove("bannerImage");
    Some(banner)
}

fn set_banner(extensions: &mut Map<String, Value>, uri: &str) {
    if let Some(profile) = extensions.get_mut("publicProfile").and_then(Value::as_object_mut) {
        profile.insert("bannerImage".to_string(), json!(uri));
    }
}

fn banner_file_bytes(state: &AppState, banner: &str) -> Option<(String, Vec<u8>)> {
    data_url_from_current_file(state, banner).and_then(|url| decode_image_data_url(&url))
}

fn has_avatar_reference(character: &Value) -> bool {
    ["avatar", "avatarPath", "avatarFilePath"].iter().any(|field| {
        character
            .get(*field)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    })
}

/// De-Koi stores "@Depth" as 2; SillyTavern-style card extensions use 4.
/// Other values (0 before, 1 after, and SillyTavern-origin 3+) pass through.
const DE_KOI_DEPTH_POSITION: i64 = 2;
const CARD_DEPTH_POSITION: i64 = 4;

fn card_extension_position(position: i64) -> i64 {
    if position == DE_KOI_DEPTH_POSITION {
        CARD_DEPTH_POSITION
    } else {
        position
    }
}

/// The V3 `position` field only defines before/after the character, so
/// depth placement leaves it out and is carried by `extensions.position`.
fn card_primary_position(position: i64) -> Option<&'static str> {
    match position {
        p if p <= 0 => Some("before_char"),
        1 => Some("after_char"),
        _ => None,
    }
}

fn default_icon() -> Value {
    json!({ "type": "icon", "uri": "ccdefault:", "name": "main", "ext": "png" })
}

/// Writes the linked lorebook (or the card's original book) as `character_book`.
fn character_book(state: &AppState, character_id: &str, source: &Value) -> AppResult<Option<Value>> {
    let Some(lorebook_id) = linked_embedded_lorebook_id(state, character_id, source)? else {
        return Ok(source.get("character_book").filter(|book| book.is_object()).cloned());
    };
    let Some(lorebook) = state.storage.get("lorebooks", &lorebook_id)? else {
        return Ok(source.get("character_book").filter(|book| book.is_object()).cloned());
    };
    let mut entries = list_collection(state, "lorebook-entries", Some(("lorebookId", lorebook_id.as_str())))?
        .as_array()
        .cloned()
        .unwrap_or_default();
    entries.sort_by_key(|entry| entry.get("order").and_then(Value::as_i64).unwrap_or(0));
    let entries = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| character_book_entry(entry, index))
        .collect::<Vec<_>>();
    let mut book = json!({
        "name": lorebook.get("name").and_then(Value::as_str).unwrap_or(""),
        "description": lorebook.get("description").and_then(Value::as_str).unwrap_or(""),
        "extensions": {},
        "entries": entries,
    });
    for (field, card_field) in [("scanDepth", "scan_depth"), ("tokenBudget", "token_budget")] {
        if let Some(value) = lorebook.get(field).filter(|value| value.is_number()) {
            book[card_field] = value.clone();
        }
    }
    Ok(Some(book))
}

/// V3 expresses at-depth placement with content decorators: `@@depth N` and
/// `@@role R` lines at the start of `content`. Readers that do not support a
/// decorator ignore it.
fn decorated_content(entry: &Value, position: i64) -> String {
    let content = entry.get("content").and_then(Value::as_str).unwrap_or("");
    if card_primary_position(position).is_some() {
        return content.to_string();
    }
    let depth = entry.get("depth").and_then(Value::as_i64).unwrap_or(4).max(0);
    let mut decorated = format!("@@depth {depth}\n");
    if let Some(role) = entry
        .get("role")
        .and_then(Value::as_str)
        .filter(|role| matches!(*role, "assistant" | "system" | "user"))
    {
        decorated.push_str(&format!("@@role {role}\n"));
    }
    decorated.push_str(content);
    decorated
}

fn character_book_entry(entry: &Value, index: usize) -> Value {
    let name = entry.get("name").and_then(Value::as_str).unwrap_or("");
    let order = entry.get("order").and_then(Value::as_i64).unwrap_or(index as i64);
    let position = entry.get("position").and_then(Value::as_i64).unwrap_or(0);
    let probability = entry.get("probability").cloned().unwrap_or(Value::Null);
    let mut card_entry = json!({
        "id": index,
        "keys": string_array_for_export(entry.get("keys")),
        "secondary_keys": string_array_for_export(entry.get("secondaryKeys")),
        "content": decorated_content(entry, position),
        "name": name,
        "comment": name,
        "enabled": entry.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        "constant": entry.get("constant").and_then(Value::as_bool).unwrap_or(false),
        "selective": entry.get("selective").and_then(Value::as_bool).unwrap_or(false),
        "insertion_order": order,
        "priority": order,
        "case_sensitive": entry.get("caseSensitive").and_then(Value::as_bool).unwrap_or(false),
        "use_regex": entry.get("useRegex").and_then(Value::as_bool).unwrap_or(false),
        // SillyTavern-compatible placement and activation details.
        "extensions": {
            "position": card_extension_position(position),
            "depth": entry.get("depth").cloned().unwrap_or(json!(4)),
            "role": entry.get("role").cloned().unwrap_or(Value::Null),
            "probability": probability,
            "useProbability": !probability.is_null(),
            "selectiveLogic": st_selective_logic(entry.get("selectiveLogic")),
            "scan_depth": entry.get("scanDepth").cloned().unwrap_or(Value::Null),
            "match_whole_words": entry.get("matchWholeWords").and_then(Value::as_bool).unwrap_or(false),
            "group": entry.get("group").and_then(Value::as_str).unwrap_or(""),
            "group_weight": entry.get("groupWeight").cloned().unwrap_or(Value::Null),
            "prevent_recursion": entry.get("preventRecursion").and_then(Value::as_bool).unwrap_or(false),
            "sticky": entry.get("sticky").cloned().unwrap_or(Value::Null),
            "cooldown": entry.get("cooldown").cloned().unwrap_or(Value::Null),
            "delay": entry.get("delay").cloned().unwrap_or(Value::Null),
        },
    });
    if let Some(primary) = card_primary_position(position) {
        card_entry["position"] = json!(primary);
    }
    card_entry
}

/// Collects CHARX files within the package limits import enforces.
struct AssetPackager {
    target: CardTarget,
    files: Vec<PackagedAsset>,
    total_bytes: usize,
}

impl AssetPackager {
    fn new(target: CardTarget) -> Self {
        Self {
            target,
            files: Vec::new(),
            total_bytes: 0,
        }
    }

    /// Adds `stem.ext` and returns its card URI, or records why it was skipped.
    fn add(
        &mut self,
        stem: &str,
        ext: &str,
        bytes: Vec<u8>,
        character: &str,
        label: impl Into<String>,
        report: &mut ExportReport,
    ) -> Option<String> {
        let label = label.into();
        if self.target != CardTarget::Charx {
            return None;
        }
        if bytes.len() > CHARX_MAX_ASSET_BYTES {
            report.skip(
                character,
                label,
                format!("The file is larger than the {} MB CHARX asset limit.", CHARX_MAX_ASSET_BYTES / (1024 * 1024)),
            );
            return None;
        }
        // card.json takes one entry.
        if self.files.len() + 1 >= CHARX_MAX_ENTRIES {
            report.skip(character, label, format!("The package reached the {CHARX_MAX_ENTRIES}-file CHARX limit."));
            return None;
        }
        if self.total_bytes.saturating_add(bytes.len()) > CHARX_MAX_TOTAL_BYTES {
            report.skip(
                character,
                label,
                format!("The package reached the {} MB CHARX size limit.", CHARX_MAX_TOTAL_BYTES / (1024 * 1024)),
            );
            return None;
        }
        let path = format!("{stem}.{ext}");
        self.total_bytes += bytes.len();
        self.files.push(PackagedAsset { path: path.clone(), bytes });
        report.include(character, label);
        Some(format!("{CHARX_SCHEME}{path}"))
    }
}

fn unique_name(base: &str, used: &mut HashSet<String>) -> String {
    let mut candidate = base.to_string();
    let mut counter = 2;
    while !used.insert(candidate.to_ascii_lowercase()) {
        candidate = format!("{base}_{counter}");
        counter += 1;
    }
    candidate
}

/// Decodes a base64 image data URL into a file extension and bytes.
fn decode_image_data_url(url: &str) -> Option<(String, Vec<u8>)> {
    let rest = url.strip_prefix("data:image/")?;
    let (mime, payload) = rest.split_once(";base64,")?;
    let ext = match mime.to_ascii_lowercase().as_str() {
        "jpeg" | "jpg" => "jpg",
        "webp" => "webp",
        "gif" => "gif",
        "avif" => "avif",
        "png" => "png",
        _ => return None,
    };
    let bytes = general_purpose::STANDARD.decode(payload.trim()).ok()?;
    Some((ext.to_string(), bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_map_to_card_placement() {
        assert_eq!(card_primary_position(0), Some("before_char"));
        assert_eq!(card_primary_position(1), Some("after_char"));
        assert_eq!(card_primary_position(2), None);
        assert_eq!(card_extension_position(0), 0);
        assert_eq!(card_extension_position(1), 1);
        assert_eq!(card_extension_position(2), 4);
        assert_eq!(card_extension_position(3), 3);
    }

    #[test]
    fn at_depth_entries_carry_v3_decorators() {
        let depth = json!({ "content": "Shrine lore", "depth": 3, "role": "assistant" });
        let before = json!({ "content": "Koi lore", "depth": 3, "role": "assistant" });

        assert_eq!(decorated_content(&depth, 2), "@@depth 3\n@@role assistant\nShrine lore");
        assert_eq!(decorated_content(&before, 0), "Koi lore");
        assert_eq!(decorated_content(&before, 1), "Koi lore");
    }

    #[test]
    fn unique_names_never_collide_case_insensitively() {
        let mut used = HashSet::new();
        assert_eq!(unique_name("happy", &mut used), "happy");
        assert_eq!(unique_name("Happy", &mut used), "Happy_2");
        assert_eq!(unique_name("happy", &mut used), "happy_3");
    }

    #[test]
    fn packager_enforces_asset_and_total_limits_and_reports_skips() {
        let mut packager = AssetPackager::new(CardTarget::Charx);
        let mut report = ExportReport::default();

        let too_big = vec![0u8; CHARX_MAX_ASSET_BYTES + 1];
        assert!(packager.add("assets/x/huge", "png", too_big, "Sol", "Huge", &mut report).is_none());
        let uri = packager
            .add("assets/x/small", "png", vec![1, 2, 3], "Sol", "Small", &mut report)
            .expect("small asset fits");

        assert_eq!(uri, "embeded://assets/x/small.png");
        assert_eq!(report.to_value()["skipped"][0]["asset"], "Huge");
        assert_eq!(report.to_value()["included"][0]["asset"], "Small");
    }

    #[test]
    fn image_data_urls_decode_only_for_supported_images() {
        let png = format!("data:image/png;base64,{}", general_purpose::STANDARD.encode([1u8, 2, 3]));
        assert_eq!(decode_image_data_url(&png), Some(("png".to_string(), vec![1, 2, 3])));
        assert!(decode_image_data_url("data:image/svg+xml;base64,PHN2Zz4=").is_none());
        assert!(decode_image_data_url("https://example.com/a.png").is_none());
    }

    #[test]
    fn portable_extensions_drop_import_runtime_metadata() {
        let source = json!({
            "extensions": {
                "importMetadata": { "embeddedLorebook": { "lorebookId": "runtime-id" } },
                "talkativeness": "0.5",
            }
        });

        let extensions = portable_extensions(&source);

        assert!(!extensions.contains_key("importMetadata"));
        assert_eq!(extensions["talkativeness"], "0.5");
    }
}
