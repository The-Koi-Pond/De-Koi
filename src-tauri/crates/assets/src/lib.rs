use base64::{engine::general_purpose, Engine as _};
use image::{imageops::FilterType, ImageFormat, ImageReader, Limits};
use marinara_core::{now_iso, AppError, AppResult};
use marinara_security::{assert_inside_dir, assert_relative_safe_path};
use serde_json::{json, Map, Value};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const MANAGED_GAME_ASSET_CATEGORIES: &[&str] =
    &["music", "sfx", "ambient", "sprites", "backgrounds"];
const MAX_TEXT_ASSET_BYTES: usize = 10 * 1024 * 1024;
const MAX_MEDIA_ASSET_BYTES: usize = 75 * 1024 * 1024;
const GENERATED_BACKGROUND_WIDTH: u32 = 1280;
const GENERATED_BACKGROUND_HEIGHT: u32 = 720;
const MAX_GENERATED_BACKGROUND_DIMENSION: u32 = 8192;
const MAX_GENERATED_BACKGROUND_PIXELS: u64 = 50_000_000;
const MAX_GENERATED_BACKGROUND_ALLOC_BYTES: u64 = 256 * 1024 * 1024;
const GENERATED_BACKGROUND_RESIZE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];
const RASTER_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "avif"];
const SPRITE_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "ogg", "wav", "flac", "m4a", "aac", "opus", "webm"];
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "jsonl", "yaml", "yml", "csv", "log", "js", "ts", "tsx",
    "css", "html",
];

#[derive(Clone)]
pub struct AssetService {
    root: PathBuf,
}

impl AssetService {
    pub fn new(root: impl Into<PathBuf>) -> AppResult<Self> {
        let root = root.into();
        fs::create_dir_all(&root)?;
        Ok(Self {
            root: root.canonicalize()?,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn seed_missing_from(&self, seed_root: &Path) -> AppResult<()> {
        if !seed_root.exists() {
            return Ok(());
        }
        copy_missing(seed_root, &self.root)
    }

    pub fn absolute_path(&self, path: &str) -> AppResult<PathBuf> {
        assert_inside_dir(&self.root, &assert_relative_safe_path(path)?)
    }

    pub fn absolute_path_string(&self, path: &str) -> AppResult<String> {
        Ok(self.absolute_path(path)?.to_string_lossy().to_string())
    }

    pub fn list(&self, subfolder: Option<&str>) -> AppResult<Vec<Value>> {
        let dir = match subfolder {
            Some(path) if !path.trim().is_empty() => self.absolute_path(path)?,
            _ => self.root.clone(),
        };
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut rows = Vec::new();
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            if should_skip_asset_entry(&path) {
                continue;
            }
            rows.push(self.entry_to_json(path)?);
        }
        sort_asset_rows(&mut rows);
        Ok(rows)
    }

    pub fn tree(&self) -> AppResult<Value> {
        self.node_for_path(&self.root, "game-assets")
    }

    pub fn manifest(&self) -> AppResult<Value> {
        let mut assets = Map::new();
        let mut by_category: Map<String, Value> = Map::new();
        let mut count = 0usize;
        self.collect_manifest_entries(&self.root, &mut assets, &mut by_category, &mut count)?;
        Ok(json!({
            "scannedAt": now_iso(),
            "count": count,
            "root": self.root.to_string_lossy(),
            "assets": assets,
            "byCategory": by_category
        }))
    }

    pub fn manifest_with_backgrounds(&self, backgrounds: &AssetService) -> AppResult<Value> {
        let mut assets = Map::new();
        let mut by_category: Map<String, Value> = Map::new();
        let mut count = 0usize;
        self.collect_manifest_entries(&self.root, &mut assets, &mut by_category, &mut count)?;
        backgrounds.collect_user_background_entries(
            backgrounds.root(),
            &mut assets,
            &mut by_category,
            &mut count,
        )?;
        Ok(json!({
            "scannedAt": now_iso(),
            "count": count,
            "root": self.root.to_string_lossy(),
            "backgroundRoot": backgrounds.root().to_string_lossy(),
            "assets": assets,
            "byCategory": by_category
        }))
    }

    pub fn set_folder_description(&self, path: &str, description: &str) -> AppResult<Value> {
        let folder = self.absolute_path(path)?;
        if !folder.exists() {
            return Err(AppError::not_found("Asset folder was not found"));
        }
        if !folder.is_dir() {
            return Err(AppError::invalid_input("Asset path is not a folder"));
        }
        let rel = self.relative_string(&folder);
        let description = description.trim();
        let meta_path = self.root.join("meta.json");
        let mut meta = read_root_folder_metadata(&meta_path);
        if description.is_empty() {
            meta.remove(&rel);
        } else {
            meta.insert(rel.clone(), Value::String(description.to_string()));
        }
        if meta.is_empty() {
            remove_metadata_file_if_present(&meta_path)?;
        } else {
            fs::write(&meta_path, serde_json::to_vec_pretty(&Value::Object(meta))?)?;
        }
        remove_folder_metadata_description(&folder)?;
        Ok(json!({ "path": path, "description": description }))
    }

    pub fn read_text(&self, path: &str) -> AppResult<String> {
        let path = self.absolute_path(path)?;
        ensure_text_asset_path(&path)?;
        let metadata = fs::metadata(&path)?;
        if metadata.len() > MAX_TEXT_ASSET_BYTES as u64 {
            return Err(AppError::invalid_input("Text asset is too large to read"));
        }
        Ok(fs::read_to_string(path)?)
    }

    pub fn write_text(&self, path: &str, content: &str) -> AppResult<()> {
        let path = self.absolute_path(path)?;
        ensure_text_asset_path(&path)?;
        if content.len() > MAX_TEXT_ASSET_BYTES {
            return Err(AppError::invalid_input("Text asset is too large to write"));
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, content)?;
        Ok(())
    }

    pub fn create_folder(&self, path: &str) -> AppResult<()> {
        let folder = self.absolute_path(path)?;
        if folder.exists() {
            return Err(AppError::conflict("Asset folder already exists"));
        }
        fs::create_dir_all(folder)?;
        Ok(())
    }

    pub fn remove_folder(&self, path: &str, recursive: bool) -> AppResult<()> {
        ensure_removable_asset_path(path)?;
        let path = self.absolute_path(path)?;
        if !path.exists() {
            return Err(AppError::not_found("Asset folder was not found"));
        }
        if !path.is_dir() {
            return Err(AppError::invalid_input("Asset path is not a folder"));
        }
        let rel = self.relative_string(&path);
        if recursive {
            fs::remove_dir_all(&path)?;
        } else {
            fs::remove_dir(&path)?;
        }
        remove_root_folder_metadata_subtree(&self.root, &rel)?;
        Ok(())
    }

    pub fn remove_file(&self, path: &str) -> AppResult<()> {
        ensure_removable_asset_path(path)?;
        let path = self.absolute_path(path)?;
        if !path.exists() {
            return Err(AppError::not_found("Asset file was not found"));
        }
        if !path.is_file() {
            return Err(AppError::invalid_input("Asset path is not a file"));
        }
        fs::remove_file(path)?;
        Ok(())
    }

    pub fn rename(&self, path: &str, new_name: &str) -> AppResult<Value> {
        if new_name.contains('/') || new_name.contains('\\') || new_name.trim().is_empty() {
            return Err(AppError::invalid_input("Invalid asset name"));
        }
        let sanitized_name = sanitize_filename(new_name)?;
        let source = self.absolute_path(path)?;
        let target = assert_inside_dir(
            &self.root,
            &source
                .parent()
                .ok_or_else(|| AppError::invalid_input("Asset has no parent folder"))?
                .join(sanitized_name),
        )?;
        if target.exists() {
            return Err(AppError::conflict("Asset already exists"));
        }
        let source_is_dir = source.is_dir();
        let source_rel = self.relative_string(&source);
        fs::rename(&source, &target)?;
        if source_is_dir {
            move_root_folder_metadata_subtree(
                &self.root,
                &source_rel,
                &self.relative_string(&target),
            )?;
        }
        Ok(json!({ "path": self.relative_string(&target) }))
    }

    pub fn copy_to_folder(&self, path: &str, target_folder: &str) -> AppResult<Value> {
        let source = self.absolute_path(path)?;
        let target_dir = self.absolute_path(target_folder)?;
        fs::create_dir_all(&target_dir)?;
        let file_name = source
            .file_name()
            .ok_or_else(|| AppError::invalid_input("Asset has no filename"))?;
        let target = unique_target_path(&target_dir.join(file_name))?;
        if source.is_dir() {
            copy_missing(&source, &target)?;
        } else {
            fs::copy(&source, &target)?;
        }
        Ok(json!({ "path": self.relative_string(&target) }))
    }

    pub fn move_to_folder(&self, path: &str, target_folder: &str) -> AppResult<Value> {
        let source = self.absolute_path(path)?;
        let target_dir = self.absolute_path(target_folder)?;
        fs::create_dir_all(&target_dir)?;
        let file_name = source
            .file_name()
            .ok_or_else(|| AppError::invalid_input("Asset has no filename"))?;
        let target = unique_target_path(&target_dir.join(file_name))?;
        let source_is_dir = source.is_dir();
        let source_rel = self.relative_string(&source);
        fs::rename(&source, &target)?;
        if source_is_dir {
            move_root_folder_metadata_subtree(
                &self.root,
                &source_rel,
                &self.relative_string(&target),
            )?;
        }
        Ok(json!({ "path": self.relative_string(&target) }))
    }

    pub fn write_upload(
        &self,
        category: &str,
        subcategory: Option<&str>,
        file: &Value,
    ) -> AppResult<Value> {
        if !MANAGED_GAME_ASSET_CATEGORIES.contains(&category) {
            return Err(AppError::invalid_input("Invalid game asset category"));
        }
        let original_name = file
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty())
            .ok_or_else(|| AppError::invalid_input("Uploaded file is missing a name"))?;
        let name = sanitize_filename(original_name)?;
        let is_text_upload = is_text_asset_path(Path::new(&name));
        ensure_upload_extension(category, &name)?;
        let safe_subcategory = subcategory
            .filter(|value| !value.trim().is_empty())
            .map(assert_relative_safe_path)
            .transpose()?;
        let base64 = file
            .get("base64")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::invalid_input("Uploaded file is missing base64 data"))?;
        let mut bytes = general_purpose::STANDARD.decode(base64).map_err(|error| {
            AppError::invalid_input(format!("Invalid upload encoding: {error}"))
        })?;
        if is_text_upload && bytes.len() > MAX_TEXT_ASSET_BYTES {
            return Err(AppError::invalid_input("Text asset is too large to upload"));
        }
        if !is_text_upload && bytes.len() > MAX_MEDIA_ASSET_BYTES {
            return Err(AppError::invalid_input("Uploaded file is too large"));
        }
        if should_resize_generated_background_upload(category, subcategory, &name) {
            bytes = cover_resize_generated_background(&name, &bytes)?;
        }

        let mut rel = PathBuf::from(category);
        if let Some(subcategory) = safe_subcategory {
            rel.push(subcategory);
        }
        let dir = assert_inside_dir(&self.root, &rel)?;
        fs::create_dir_all(&dir)?;
        let target = unique_target_path(&dir.join(name))?;
        fs::write(&target, bytes)?;
        let item = self.entry_to_json(target)?;
        Ok(json!({ "uploaded": true, "item": item }))
    }

    pub fn delete_many(&self, paths: &[String]) -> Value {
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        for path in paths {
            match self.remove_file(path) {
                Ok(()) => succeeded.push(Value::String(path.clone())),
                Err(error) => failed.push(json!({ "path": path, "error": error.message })),
            }
        }
        json!({ "succeeded": succeeded, "failed": failed })
    }

    pub fn copy_many(&self, paths: &[String], target_folder: &str) -> Value {
        self.transfer_many(paths, target_folder, false)
    }

    pub fn move_many(&self, paths: &[String], target_folder: &str) -> Value {
        self.transfer_many(paths, target_folder, true)
    }

    pub fn file_info(&self, path: &str) -> AppResult<Value> {
        let absolute = self.absolute_path(path)?;
        let metadata = fs::metadata(&absolute)?;
        let name = absolute
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());
        let (width, height) = image_dimensions_for(&absolute);
        let mut info = json!({
            "name": name,
            "path": self.relative_string(&absolute),
            "absolutePath": absolute.to_string_lossy(),
            "size": if metadata.is_file() { metadata.len() } else { 0 },
            "format": absolute.extension().map(|ext| ext.to_string_lossy().to_ascii_lowercase()),
            "modified": system_time_iso(metadata.modified().ok()),
            "created": system_time_iso(metadata.created().ok())
        });
        if let Some(width) = width {
            info["width"] = json!(width);
        }
        if let Some(height) = height {
            info["height"] = json!(height);
        }
        Ok(info)
    }

    fn transfer_many(&self, paths: &[String], target_folder: &str, move_files: bool) -> Value {
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        for path in paths {
            let result = if move_files {
                self.move_to_folder(path, target_folder)
            } else {
                self.copy_to_folder(path, target_folder)
            };
            match result {
                Ok(_) => succeeded.push(Value::String(path.clone())),
                Err(error) => failed.push(json!({ "path": path, "error": error.message })),
            }
        }
        json!({ "succeeded": succeeded, "failed": failed, "targetFolder": target_folder })
    }

    fn node_for_path(&self, path: &Path, root_name: &str) -> AppResult<Value> {
        let metadata = fs::metadata(path)?;
        let rel = self.relative_string(path);
        let name = if rel.is_empty() {
            root_name.to_string()
        } else {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| root_name.to_string())
        };
        if metadata.is_dir() {
            let description = self.folder_description(path);
            let mut children = Vec::new();
            for entry in fs::read_dir(path)? {
                let child_path = entry?.path();
                if should_skip_asset_entry(&child_path)
                    || child_path.file_name().and_then(|name| name.to_str()) == Some("meta.json")
                {
                    continue;
                }
                children.push(self.node_for_path(&child_path, root_name)?);
            }
            sort_asset_rows(&mut children);
            let mut node = json!({
                "name": name,
                "path": rel,
                "type": "folder",
                "children": children,
                "size": 0,
                "modified": system_time_iso(metadata.modified().ok()),
                "absolutePath": path.to_string_lossy()
            });
            if is_native_asset_folder(&rel) {
                node["native"] = Value::Bool(true);
            }
            if let Some(description) = description {
                node["description"] = Value::String(description);
            }
            return Ok(node);
        }
        self.entry_to_json(path.to_path_buf())
    }

    fn entry_to_json(&self, path: PathBuf) -> AppResult<Value> {
        let metadata = fs::metadata(&path)?;
        let rel = self.relative_string(&path);
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| rel.clone());
        let ext = path
            .extension()
            .map(|ext| format!(".{}", ext.to_string_lossy().to_ascii_lowercase()))
            .unwrap_or_default();
        Ok(json!({
            "path": rel,
            "absolutePath": path.to_string_lossy(),
            "name": name,
            "type": if metadata.is_dir() { "folder" } else { "file" },
            "isDirectory": metadata.is_dir(),
            "ext": ext,
            "size": if metadata.is_file() { metadata.len() } else { 0 },
            "modified": system_time_iso(metadata.modified().ok())
        }))
    }

    fn collect_manifest_entries(
        &self,
        path: &Path,
        assets: &mut Map<String, Value>,
        by_category: &mut Map<String, Value>,
        count: &mut usize,
    ) -> AppResult<()> {
        if !path.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(path)? {
            let path = entry?.path();
            if should_skip_asset_entry(&path) {
                continue;
            }
            if path.is_dir() {
                self.collect_manifest_entries(&path, assets, by_category, count)?;
                continue;
            }
            let rel = self.relative_string(&path);
            let segments: Vec<&str> = rel.split('/').collect();
            let Some(category) = segments.first().copied() else {
                continue;
            };
            if !MANAGED_GAME_ASSET_CATEGORIES.contains(&category) || segments.len() < 2 {
                continue;
            }
            if !is_supported_manifest_asset(category, &path) {
                continue;
            }
            let stem_path = rel
                .rsplit_once('.')
                .map(|(stem, _)| stem)
                .unwrap_or(rel.as_str())
                .to_string();
            let tag = manifest_tag_for_asset(&segments, &stem_path);
            let ext = path
                .extension()
                .map(|ext| format!(".{}", ext.to_string_lossy().to_ascii_lowercase()))
                .unwrap_or_default();
            let subcategory = if segments.len() > 2 {
                segments[1..segments.len() - 1].join("/")
            } else {
                String::new()
            };
            let name = path
                .file_stem()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| tag.clone());
            let value = json!({
                "tag": tag,
                "category": category,
                "subcategory": subcategory,
                "name": name,
                "path": rel,
                "absolutePath": path.to_string_lossy(),
                "ext": ext
            });
            by_category
                .entry(category.to_string())
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .expect("by_category entry is always an array")
                .push(value.clone());
            assets.insert(tag, value);
            *count += 1;
        }
        Ok(())
    }

    fn collect_user_background_entries(
        &self,
        path: &Path,
        assets: &mut Map<String, Value>,
        by_category: &mut Map<String, Value>,
        count: &mut usize,
    ) -> AppResult<()> {
        if !path.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(path)? {
            let path = entry?.path();
            if should_skip_asset_entry(&path) {
                continue;
            }
            if path.is_dir() {
                self.collect_user_background_entries(&path, assets, by_category, count)?;
                continue;
            }
            if !RASTER_IMAGE_EXTENSIONS.contains(&path_extension(&path).as_str()) {
                continue;
            }
            let rel = self.relative_string(&path);
            let stem_path = rel
                .rsplit_once('.')
                .map(|(stem, _)| stem)
                .unwrap_or(rel.as_str());
            let tag = format!("backgrounds:user:{}", stem_path.replace('/', ":"));
            if assets.contains_key(&tag) {
                continue;
            }
            let ext = path
                .extension()
                .map(|ext| format!(".{}", ext.to_string_lossy().to_ascii_lowercase()))
                .unwrap_or_default();
            let segments: Vec<&str> = rel.split('/').collect();
            let subcategory = if segments.len() > 1 {
                format!("user/{}", segments[..segments.len() - 1].join("/"))
            } else {
                "user".to_string()
            };
            let name = path
                .file_stem()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| tag.clone());
            let value = json!({
                "tag": tag,
                "category": "backgrounds",
                "subcategory": subcategory,
                "name": name,
                "path": format!("__user_bg__/{rel}"),
                "absolutePath": path.to_string_lossy(),
                "ext": ext,
                "managedSource": "backgrounds"
            });
            by_category
                .entry("backgrounds".to_string())
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .expect("by_category entry is always an array")
                .push(value.clone());
            assets.insert(tag, value);
            *count += 1;
        }
        Ok(())
    }

    fn relative_string(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
            .to_string()
    }

    fn folder_description(&self, path: &Path) -> Option<String> {
        let rel = self.relative_string(path);
        root_folder_description(&self.root.join("meta.json"), &rel)
            .or_else(|| folder_metadata_description(path))
    }
}

fn root_folder_description(meta_path: &Path, rel: &str) -> Option<String> {
    read_root_folder_metadata(meta_path)
        .get(rel)
        .and_then(folder_metadata_entry_description)
}

fn folder_metadata_description(path: &Path) -> Option<String> {
    let meta = fs::read_to_string(path.join("meta.json")).ok()?;
    let value: Value = serde_json::from_str(&meta).ok()?;
    folder_metadata_entry_description(&value)
}

fn folder_metadata_entry_description(value: &Value) -> Option<String> {
    value
        .as_str()
        .or_else(|| value.get("description").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn read_root_folder_metadata(meta_path: &Path) -> Map<String, Value> {
    fs::read_to_string(meta_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn remove_metadata_file_if_present(meta_path: &Path) -> AppResult<()> {
    match fs::remove_file(meta_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn remove_folder_metadata_description(folder: &Path) -> AppResult<()> {
    let meta_path = folder.join("meta.json");
    let Ok(raw) = fs::read_to_string(&meta_path) else {
        return Ok(());
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return Ok(());
    };
    let Some(mut meta) = value.as_object().cloned() else {
        return remove_metadata_file_if_present(&meta_path);
    };
    meta.remove("description");
    if meta.is_empty() {
        remove_metadata_file_if_present(&meta_path)
    } else {
        fs::write(&meta_path, serde_json::to_vec_pretty(&Value::Object(meta))?)?;
        Ok(())
    }
}

fn remove_root_folder_metadata_subtree(root: &Path, rel: &str) -> AppResult<()> {
    if rel.is_empty() {
        return Ok(());
    }
    let meta_path = root.join("meta.json");
    let mut meta = read_root_folder_metadata(&meta_path);
    if meta.is_empty() {
        return Ok(());
    }
    let prefix = format!("{rel}/");
    let keys: Vec<String> = meta
        .keys()
        .filter(|key| *key == rel || key.starts_with(&prefix))
        .cloned()
        .collect();
    if keys.is_empty() {
        return Ok(());
    }
    for key in keys {
        meta.remove(&key);
    }
    write_root_folder_metadata(&meta_path, meta)
}

fn move_root_folder_metadata_subtree(root: &Path, old_rel: &str, new_rel: &str) -> AppResult<()> {
    if old_rel.is_empty() || old_rel == new_rel {
        return Ok(());
    }
    let meta_path = root.join("meta.json");
    let mut meta = read_root_folder_metadata(&meta_path);
    if meta.is_empty() {
        return Ok(());
    }
    let prefix = format!("{old_rel}/");
    let keys: Vec<String> = meta
        .keys()
        .filter(|key| *key == old_rel || key.starts_with(&prefix))
        .cloned()
        .collect();
    if keys.is_empty() {
        return Ok(());
    }
    let mut moved = Vec::new();
    for key in keys {
        if let Some(value) = meta.remove(&key) {
            let next_key = if key == old_rel {
                new_rel.to_string()
            } else {
                format!("{new_rel}/{}", key.trim_start_matches(&prefix))
            };
            moved.push((next_key, value));
        }
    }
    for (key, value) in moved {
        meta.insert(key, value);
    }
    write_root_folder_metadata(&meta_path, meta)
}

fn write_root_folder_metadata(meta_path: &Path, meta: Map<String, Value>) -> AppResult<()> {
    if meta.is_empty() {
        remove_metadata_file_if_present(meta_path)
    } else {
        fs::write(meta_path, serde_json::to_vec_pretty(&Value::Object(meta))?)?;
        Ok(())
    }
}

fn path_extension(path: &Path) -> String {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_text_asset_path(path: &Path) -> bool {
    let extension = path_extension(path);
    TEXT_EXTENSIONS.contains(&extension.as_str())
}

fn ensure_text_asset_path(path: &Path) -> AppResult<()> {
    if is_text_asset_path(path) {
        Ok(())
    } else {
        Err(AppError::invalid_input(
            "Only text asset files can be edited as text",
        ))
    }
}

fn ensure_removable_asset_path(path: &str) -> AppResult<()> {
    let normalized = path
        .trim()
        .trim_matches(|ch| ch == '/' || ch == '\\')
        .replace('\\', "/");
    if normalized.is_empty() {
        return Err(AppError::invalid_input(
            "Game asset root folder cannot be deleted",
        ));
    }
    if is_native_asset_folder(&normalized) {
        return Err(AppError::invalid_input(
            "Managed game asset category folders cannot be deleted",
        ));
    }
    Ok(())
}

fn manifest_tag_for_asset(segments: &[&str], stem_path: &str) -> String {
    if segments.first().copied() == Some("music") && segments.len() == 3 {
        let state = segments[1];
        if let Some(intensity) = default_music_intensity_for_state(state) {
            let name = stem_path.rsplit('/').next().unwrap_or(stem_path);
            return format!("music:{state}:custom:{intensity}:{name}");
        }
    }
    stem_path.replace('/', ":")
}

fn default_music_intensity_for_state(state: &str) -> Option<&'static str> {
    match state {
        "exploration" => Some("tense"),
        "dialogue" => Some("calm"),
        "combat" => Some("intense"),
        "travel_rest" => Some("calm"),
        _ => None,
    }
}

fn ensure_upload_extension(category: &str, filename: &str) -> AppResult<()> {
    let extension = path_extension(Path::new(filename));
    let allowed = match category {
        "music" | "sfx" | "ambient" => AUDIO_EXTENSIONS,
        "sprites" => SPRITE_IMAGE_EXTENSIONS,
        "backgrounds" => RASTER_IMAGE_EXTENSIONS,
        _ => {
            return Err(AppError::invalid_input(format!(
                "Can't upload .{extension} files to {category}"
            )))
        }
    };
    if allowed.contains(&extension.as_str()) || TEXT_EXTENSIONS.contains(&extension.as_str()) {
        Ok(())
    } else {
        Err(AppError::invalid_input(format!(
            "Can't upload .{extension} files to {category}"
        )))
    }
}

fn is_supported_manifest_asset(category: &str, path: &Path) -> bool {
    let extension = path_extension(path);
    match category {
        "music" | "sfx" | "ambient" => AUDIO_EXTENSIONS.contains(&extension.as_str()),
        "sprites" => SPRITE_IMAGE_EXTENSIONS.contains(&extension.as_str()),
        "backgrounds" => RASTER_IMAGE_EXTENSIONS.contains(&extension.as_str()),
        _ => false,
    }
}

fn should_resize_generated_background_upload(
    category: &str,
    subcategory: Option<&str>,
    filename: &str,
) -> bool {
    category == "backgrounds"
        && !is_text_asset_path(Path::new(filename))
        && subcategory
            .map(|value| {
                value
                    .split(|ch| ch == '/' || ch == '\\')
                    .any(|part| part == "generated")
            })
            .unwrap_or(false)
}

fn cover_resize_generated_background(filename: &str, bytes: &[u8]) -> AppResult<Vec<u8>> {
    let format = generated_background_resize_format(filename)?;
    let (width, height) = ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|error| {
            AppError::invalid_input(format!(
                "Generated background dimensions could not be read: {error}"
            ))
        })?;
    let pixels = u64::from(width) * u64::from(height);
    if width > MAX_GENERATED_BACKGROUND_DIMENSION
        || height > MAX_GENERATED_BACKGROUND_DIMENSION
        || pixels > MAX_GENERATED_BACKGROUND_PIXELS
    {
        return Err(AppError::invalid_input(
            "Generated background dimensions are too large",
        ));
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(generated_background_decode_limits());
    let image = reader.decode().map_err(|error| {
        AppError::invalid_input(format!(
            "Generated background could not be decoded: {error}"
        ))
    })?;
    let resized = image.resize_to_fill(
        GENERATED_BACKGROUND_WIDTH,
        GENERATED_BACKGROUND_HEIGHT,
        FilterType::Lanczos3,
    );
    let mut output = Vec::new();
    resized
        .write_to(&mut Cursor::new(&mut output), format)
        .map_err(|error| {
            AppError::new(
                "generated_background_resize_error",
                format!("Generated background could not be resized: {error}"),
            )
        })?;
    Ok(output)
}

fn generated_background_resize_format(filename: &str) -> AppResult<ImageFormat> {
    let extension = path_extension(Path::new(filename));
    if !GENERATED_BACKGROUND_RESIZE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::invalid_input(
            "Generated background uploads support PNG, JPEG, and WebP",
        ));
    }
    match extension.as_str() {
        "png" => Ok(ImageFormat::Png),
        "jpg" | "jpeg" => Ok(ImageFormat::Jpeg),
        "webp" => Ok(ImageFormat::WebP),
        _ => unreachable!("generated background resize extension list drifted"),
    }
}

fn generated_background_decode_limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_GENERATED_BACKGROUND_DIMENSION);
    limits.max_image_height = Some(MAX_GENERATED_BACKGROUND_DIMENSION);
    limits.max_alloc = Some(MAX_GENERATED_BACKGROUND_ALLOC_BYTES);
    limits
}

fn sanitize_filename(name: &str) -> AppResult<String> {
    let sanitized = name
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim_matches('.')
        .trim()
        .to_string();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        return Err(AppError::invalid_input("Invalid uploaded filename"));
    }
    Ok(sanitized)
}

fn should_skip_asset_entry(path: &Path) -> bool {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(true)
    {
        return true;
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.') || name == "manifest.json" || name == "meta.json")
        .unwrap_or(false)
}

fn is_native_asset_folder(rel: &str) -> bool {
    !rel.is_empty() && !rel.contains('/') && MANAGED_GAME_ASSET_CATEGORIES.contains(&rel)
}

fn system_time_iso(value: Option<SystemTime>) -> String {
    value
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|date| date.to_rfc3339())
        .unwrap_or_else(now_iso)
}

fn image_dimensions_for(path: &Path) -> (Option<u32>, Option<u32>) {
    if !RASTER_IMAGE_EXTENSIONS.contains(&path_extension(path).as_str()) {
        return (None, None);
    }
    image::image_dimensions(path)
        .map(|(width, height)| (Some(width), Some(height)))
        .unwrap_or((None, None))
}

fn copy_missing(source: &Path, target: &Path) -> AppResult<()> {
    if fs::symlink_metadata(source)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(true)
    {
        return Ok(());
    }

    if source.is_dir() {
        fs::create_dir_all(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_missing(&entry.path(), &target.join(entry.file_name()))?;
        }
        return Ok(());
    }
    if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, target)?;
    }
    Ok(())
}

fn unique_target_path(target: &Path) -> AppResult<PathBuf> {
    if !target.exists() {
        return Ok(target.to_path_buf());
    }
    let parent = target.parent().unwrap_or_else(|| Path::new(""));
    let stem = target
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "asset".to_string());
    let ext = target
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..10_000 {
        let candidate = parent.join(format!("{stem}-{index}{ext}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::invalid_input(
        "Could not find an available filename",
    ))
}

fn sort_asset_rows(rows: &mut [Value]) {
    rows.sort_by(|a, b| {
        let a_dir = a
            .get("type")
            .and_then(Value::as_str)
            .map(|kind| kind == "folder")
            .or_else(|| a.get("isDirectory").and_then(Value::as_bool))
            .unwrap_or(false);
        let b_dir = b
            .get("type")
            .and_then(Value::as_str)
            .map(|kind| kind == "folder")
            .or_else(|| b.get("isDirectory").and_then(Value::as_bool))
            .unwrap_or(false);
        b_dir.cmp(&a_dir).then_with(|| {
            let a_name = a.get("name").and_then(Value::as_str).unwrap_or("");
            let b_name = b.get("name").and_then(Value::as_str).unwrap_or("");
            a_name.cmp(b_name)
        })
    });
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_upload_extension, AssetService, AUDIO_EXTENSIONS,
        MAX_GENERATED_BACKGROUND_DIMENSION, MAX_TEXT_ASSET_BYTES, RASTER_IMAGE_EXTENSIONS,
        SPRITE_IMAGE_EXTENSIONS, TEXT_EXTENSIONS,
    };
    use base64::{engine::general_purpose, Engine as _};
    use image::{ImageFormat, Rgba, RgbaImage};
    use serde_json::{json, Value};
    use std::fs;
    #[cfg(windows)]
    use std::io;
    use std::io::Cursor;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    fn symlink_dir(source: &std::path::Path, target: &std::path::Path) -> bool {
        std::os::unix::fs::symlink(source, target).expect("create test directory symlink");
        true
    }

    #[cfg(windows)]
    fn symlink_dir(source: &std::path::Path, target: &std::path::Path) -> bool {
        const ERROR_PRIVILEGE_NOT_HELD: i32 = 1314;

        match std::os::windows::fs::symlink_dir(source, target) {
            Ok(()) => true,
            Err(error)
                if error.raw_os_error() == Some(ERROR_PRIVILEGE_NOT_HELD)
                    || matches!(
                        error.kind(),
                        io::ErrorKind::PermissionDenied | io::ErrorKind::Unsupported
                    ) =>
            {
                false
            }
            Err(error) => panic!("create test directory symlink: {error}"),
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "marinara-assets-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn png_upload_file(name: &str, width: u32, height: u32) -> Value {
        let image = RgbaImage::from_pixel(width, height, Rgba([255, 0, 0, 255]));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .expect("test image should encode");
        json!({
            "name": name,
            "base64": general_purpose::STANDARD.encode(bytes),
        })
    }

    fn text_upload_file(name: &str, content: &[u8]) -> Value {
        json!({
            "name": name,
            "base64": general_purpose::STANDARD.encode(content),
        })
    }

    fn uploaded_asset_path(root: &Path, uploaded: &Value) -> PathBuf {
        let relative = uploaded
            .get("item")
            .and_then(|item| item.get("path"))
            .and_then(Value::as_str)
            .expect("upload should return item path");
        root.join(relative)
    }

    #[test]
    fn writes_text_assets_inside_root() {
        let root = temp_root("write-inside-root");
        let service = AssetService::new(&root).expect("create asset service");

        service
            .write_text("notes/session.md", "session notes")
            .expect("write text asset");

        assert_eq!(
            fs::read_to_string(root.join("notes/session.md")).expect("read written asset"),
            "session notes"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_paths_that_escape_root_through_symlinked_directory() {
        let sandbox = temp_root("symlink-escape");
        let root = sandbox.join("game-assets");
        let outside = sandbox.join("outside");
        fs::create_dir_all(root.join("music")).expect("create asset category");
        fs::create_dir_all(&outside).expect("create outside directory");
        fs::write(outside.join("secret.txt"), "outside").expect("write outside file");
        if !symlink_dir(&outside, &root.join("music/escape")) {
            let _ = fs::remove_dir_all(sandbox);
            return;
        }

        let service = AssetService::new(&root).expect("create asset service");

        assert!(service.read_text("music/escape/secret.txt").is_err());
        assert!(service
            .write_text("music/escape/new.txt", "outside")
            .is_err());
        assert!(!outside.join("new.txt").exists());

        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn accepts_client_advertised_game_asset_upload_extensions() {
        for (category, extensions) in [
            ("music", AUDIO_EXTENSIONS),
            ("sfx", AUDIO_EXTENSIONS),
            ("ambient", AUDIO_EXTENSIONS),
            ("backgrounds", RASTER_IMAGE_EXTENSIONS),
            ("sprites", SPRITE_IMAGE_EXTENSIONS),
        ] {
            for extension in extensions {
                let filename = format!("asset.{extension}");
                assert!(
                    ensure_upload_extension(category, &filename).is_ok(),
                    "{category} should accept {filename}"
                );
            }
        }
    }

    #[test]
    fn accepts_text_asset_extensions_for_managed_category_uploads() {
        for category in ["music", "sfx", "ambient", "sprites", "backgrounds"] {
            for extension in TEXT_EXTENSIONS {
                let filename = format!("asset.{extension}");
                assert!(
                    ensure_upload_extension(category, &filename).is_ok(),
                    "{category} should accept text upload {filename}"
                );
            }
        }
    }

    #[test]
    fn rejects_svg_background_uploads() {
        let error = ensure_upload_extension("backgrounds", "wall.svg")
            .expect_err("background SVG uploads should stay sprite-only");

        assert_eq!(error.code, "invalid_input");
        assert!(error
            .message
            .contains("Can't upload .svg files to backgrounds"));
    }

    #[test]
    fn uploads_text_assets_through_managed_category_uploads() {
        let root = temp_root("text-upload-parity");
        let service = AssetService::new(&root).expect("create asset service");

        for category in ["music", "sfx", "ambient", "sprites", "backgrounds"] {
            let subcategory = if category == "backgrounds" {
                "generated/notes"
            } else {
                "notes"
            };
            let uploaded = service
                .write_upload(
                    category,
                    Some(subcategory),
                    &text_upload_file("readme.md", b"legacy notes"),
                )
                .unwrap_or_else(|error| {
                    panic!(
                        "{category} text upload should be accepted: {}",
                        error.message
                    )
                });
            let path = uploaded_asset_path(&root, &uploaded);

            assert_eq!(
                fs::read_to_string(path).expect("text upload should write readable content"),
                "legacy notes"
            );
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_text_uploads_above_text_asset_limit() {
        let root = temp_root("text-upload-size-limit");
        let service = AssetService::new(&root).expect("create asset service");
        let content = vec![b'a'; MAX_TEXT_ASSET_BYTES + 1];

        let error = service
            .write_upload(
                "music",
                Some("notes"),
                &text_upload_file("too-large.txt", &content),
            )
            .expect_err("oversized text upload should reject");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("Text asset is too large to upload"));
        assert!(!root.join("music/notes/too-large.txt").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cover_resizes_generated_background_uploads_to_vn_canvas() {
        let root = temp_root("generated-background-cover");
        let service = AssetService::new(&root).expect("create asset service");

        let uploaded = service
            .write_upload(
                "backgrounds",
                Some("generated"),
                &png_upload_file("square-scene.png", 512, 512),
            )
            .expect("generated background should upload");
        let path = uploaded_asset_path(&root, &uploaded);

        assert_eq!(
            image::image_dimensions(path).expect("background should decode"),
            (1280, 720)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cover_resizes_nested_generated_background_uploads_to_vn_canvas() {
        let root = temp_root("nested-generated-background-cover");
        let service = AssetService::new(&root).expect("create asset service");

        for (subcategory, filename) in [
            ("foo/generated", "nested-after.png"),
            ("generated/foo", "nested-before.png"),
        ] {
            let uploaded = service
                .write_upload(
                    "backgrounds",
                    Some(subcategory),
                    &png_upload_file(filename, 512, 512),
                )
                .unwrap_or_else(|error| {
                    panic!("{subcategory}/{filename} should resize: {}", error.message)
                });
            let path = uploaded_asset_path(&root, &uploaded);

            assert_eq!(
                image::image_dimensions(path).expect("background should decode"),
                (1280, 720)
            );
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_unsafe_generated_background_subcategories_before_decode() {
        let root = temp_root("unsafe-generated-subcategory");
        let service = AssetService::new(&root).expect("create asset service");

        let error = service
            .write_upload(
                "backgrounds",
                Some("generated/../escape"),
                &text_upload_file("bad-scene.png", b"not an image"),
            )
            .expect_err("unsafe generated subcategory should reject before image decode");

        assert_eq!(error.code, "invalid_input");
        assert!(error.message.contains("Path escapes are not allowed here"));
        assert!(!root.join("backgrounds/generated").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn does_not_resize_generated_illustration_uploads() {
        let root = temp_root("generated-illustration-size");
        let service = AssetService::new(&root).expect("create asset service");

        let uploaded = service
            .write_upload(
                "backgrounds",
                Some("illustrations"),
                &png_upload_file("square-illustration.png", 512, 512),
            )
            .expect("generated illustration should upload");
        let path = uploaded_asset_path(&root, &uploaded);

        assert_eq!(
            image::image_dimensions(path).expect("illustration should decode"),
            (512, 512)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn does_not_resize_whitespace_wrapped_generated_subcategory() {
        let root = temp_root("whitespace-generated-size");
        let service = AssetService::new(&root).expect("create asset service");

        let uploaded = service
            .write_upload(
                "backgrounds",
                Some(" generated "),
                &png_upload_file("spacey-generated.png", 512, 512),
            )
            .expect("noncanonical generated subcategory should upload");
        let path = uploaded_asset_path(&root, &uploaded);

        assert_eq!(
            image::image_dimensions(path).expect("background should decode"),
            (512, 512)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_oversized_generated_background_dimensions_before_decode() {
        let root = temp_root("generated-background-too-large");
        let service = AssetService::new(&root).expect("create asset service");

        let error = service
            .write_upload(
                "backgrounds",
                Some("generated"),
                &png_upload_file(
                    "oversized-scene.png",
                    MAX_GENERATED_BACKGROUND_DIMENSION + 1,
                    1,
                ),
            )
            .expect_err("oversized generated background should reject");

        assert_eq!(error.code, "invalid_input");
        assert!(error
            .message
            .contains("Generated background dimensions are too large"));
        assert!(!root
            .join("backgrounds/generated/oversized-scene.png")
            .exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_generated_background_resize_formats_without_enabled_codecs() {
        let root = temp_root("generated-background-unsupported-codec");
        let service = AssetService::new(&root).expect("create asset service");

        for extension in ["gif", "avif"] {
            let filename = format!("unsupported-scene.{extension}");
            let error = service
                .write_upload(
                    "backgrounds",
                    Some("generated"),
                    &png_upload_file(&filename, 512, 512),
                )
                .expect_err("unsupported generated background resize format should reject");

            assert_eq!(error.code, "invalid_input");
            assert!(error
                .message
                .contains("Generated background uploads support PNG, JPEG, and WebP"));
            assert!(!root.join("backgrounds/generated").join(&filename).exists());
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn does_not_resize_manual_background_uploads() {
        let root = temp_root("manual-background-size");
        let service = AssetService::new(&root).expect("create asset service");

        let uploaded = service
            .write_upload(
                "backgrounds",
                Some("custom"),
                &png_upload_file("manual-square.png", 512, 512),
            )
            .expect("manual background should upload");
        let path = uploaded_asset_path(&root, &uploaded);

        assert_eq!(
            image::image_dimensions(path).expect("manual background should decode"),
            (512, 512)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn accepts_client_advertised_text_asset_extensions() {
        let root = temp_root("text-extension-parity");
        let service = AssetService::new(&root).expect("create asset service");

        for extension in [
            "txt", "md", "markdown", "json", "jsonl", "yaml", "yml", "csv", "log", "js", "ts",
            "tsx", "css", "html",
        ] {
            let path = format!("notes/file.{extension}");
            service
                .write_text(&path, "editable")
                .unwrap_or_else(|error| panic!("{path} should be editable: {}", error.message));
            assert_eq!(
                service
                    .read_text(&path)
                    .unwrap_or_else(|error| panic!("{path} should be readable: {}", error.message)),
                "editable"
            );
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn text_assets_allow_legacy_ten_mb_contract_floor() {
        let root = temp_root("text-size-contract");
        let service = AssetService::new(&root).expect("create asset service");
        let content = "a".repeat(1_000_001);

        service
            .write_text("notes/large.txt", &content)
            .expect("text assets above old 1 MB cap should write");
        assert_eq!(
            service
                .read_text("notes/large.txt")
                .expect("text assets above old 1 MB cap should read")
                .len(),
            content.len()
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_folder_rejects_existing_asset_paths() {
        let root = temp_root("create-folder-conflict");
        fs::create_dir_all(root.join("music/existing")).expect("create existing folder");
        fs::write(root.join("music/file.mp3"), b"").expect("write existing file");
        let service = AssetService::new(&root).expect("create asset service");

        let folder_error = service
            .create_folder("music/existing")
            .expect_err("existing folder should conflict");
        assert_eq!(folder_error.code, "conflict");
        let file_error = service
            .create_folder("music/file.mp3")
            .expect_err("existing file should conflict");
        assert_eq!(file_error.code, "conflict");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deletes_require_existing_matching_asset_path_types() {
        let root = temp_root("delete-type-contract");
        fs::create_dir_all(root.join("music/folder")).expect("create folder");
        fs::write(root.join("music/theme.mp3"), b"").expect("write file");
        let service = AssetService::new(&root).expect("create asset service");

        let missing_file = service
            .remove_file("music/missing.mp3")
            .expect_err("missing file should reject");
        assert_eq!(missing_file.code, "not_found");
        let folder_as_file = service
            .remove_file("music/folder")
            .expect_err("folder should not delete through file command");
        assert_eq!(folder_as_file.code, "invalid_input");
        let file_as_folder = service
            .remove_folder("music/theme.mp3", false)
            .expect_err("file should not delete through folder command");
        assert_eq!(file_as_folder.code, "invalid_input");
        let missing_folder = service
            .remove_folder("music/missing", false)
            .expect_err("missing folder should reject");
        assert_eq!(missing_folder.code, "not_found");

        service
            .remove_file("music/theme.mp3")
            .expect("matching file delete should succeed");
        service
            .remove_folder("music/folder", false)
            .expect("matching folder delete should succeed");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bulk_delete_reports_missing_and_wrong_type_paths_as_failed() {
        let root = temp_root("bulk-delete-contract");
        fs::create_dir_all(root.join("music/folder")).expect("create folder");
        fs::write(root.join("music/theme.mp3"), b"").expect("write file");
        let service = AssetService::new(&root).expect("create asset service");

        let result = service.delete_many(&[
            "music/theme.mp3".to_string(),
            "music/folder".to_string(),
            "music/missing.mp3".to_string(),
        ]);
        let succeeded = result
            .get("succeeded")
            .and_then(Value::as_array)
            .expect("bulk delete succeeded list");
        let failed = result
            .get("failed")
            .and_then(Value::as_array)
            .expect("bulk delete failed list");

        assert_eq!(succeeded, &[json!("music/theme.mp3")]);
        assert_eq!(failed.len(), 2);
        assert!(root.join("music/folder").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_rejects_existing_target_name() {
        let root = temp_root("rename-conflict");
        fs::create_dir_all(root.join("music")).expect("create music folder");
        fs::write(root.join("music/source.mp3"), b"source").expect("write source");
        fs::write(root.join("music/target.mp3"), b"target").expect("write target");
        let service = AssetService::new(&root).expect("create asset service");

        let error = service
            .rename("music/source.mp3", "target.mp3")
            .expect_err("rename target conflict should reject");

        assert_eq!(error.code, "conflict");
        assert_eq!(
            fs::read(root.join("music/source.mp3")).expect("source should remain"),
            b"source"
        );
        assert_eq!(
            fs::read(root.join("music/target.mp3")).expect("target should remain"),
            b"target"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bulk_transfer_successes_are_original_path_strings() {
        let root = temp_root("bulk-transfer-contract");
        fs::create_dir_all(root.join("music")).expect("create music folder");
        fs::create_dir_all(root.join("sfx")).expect("create sfx folder");
        fs::create_dir_all(root.join("ambient")).expect("create ambient folder");
        fs::write(root.join("music/move.mp3"), b"move").expect("write move source");
        fs::write(root.join("music/copy.mp3"), b"copy").expect("write copy source");
        let service = AssetService::new(&root).expect("create asset service");

        let move_result = service.move_many(&["music/move.mp3".to_string()], "ambient");
        let copy_result = service.copy_many(&["music/copy.mp3".to_string()], "sfx");

        assert_eq!(
            move_result
                .get("succeeded")
                .and_then(Value::as_array)
                .expect("move succeeded list"),
            &[json!("music/move.mp3")]
        );
        assert_eq!(
            copy_result
                .get("succeeded")
                .and_then(Value::as_array)
                .expect("copy succeeded list"),
            &[json!("music/copy.mp3")]
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn manifest_only_includes_supported_category_asset_files() {
        let root = temp_root("manifest-extension-filter");
        fs::create_dir_all(root.join("music/combat")).expect("create music folder");
        fs::create_dir_all(root.join("sprites")).expect("create sprites folder");
        fs::create_dir_all(root.join("backgrounds")).expect("create backgrounds folder");
        fs::write(root.join("music/combat/theme.mp3"), b"").expect("write music asset");
        fs::write(root.join("music/combat/notes.txt"), b"not an audio asset")
            .expect("write unsupported music file");
        fs::write(root.join("music/combat/meta.json"), b"{}").expect("write folder metadata");
        fs::write(root.join("sprites/hero.svg"), b"<svg />").expect("write sprite asset");
        fs::write(root.join("backgrounds/vector.svg"), b"<svg />")
            .expect("write unsupported background file");
        let service = AssetService::new(&root).expect("create asset service");

        let manifest = service.manifest().expect("read manifest");
        let assets = manifest
            .get("assets")
            .and_then(Value::as_object)
            .expect("manifest assets");

        assert!(assets.contains_key("music:combat:custom:intense:theme"));
        assert!(assets.contains_key("sprites:hero"));
        assert!(!assets.values().any(|entry| {
            entry.get("path").and_then(Value::as_str) == Some("music/combat/notes.txt")
        }));
        assert!(!assets.values().any(|entry| {
            entry.get("path").and_then(Value::as_str) == Some("music/combat/meta.json")
        }));
        assert!(!assets.values().any(|entry| {
            entry.get("path").and_then(Value::as_str) == Some("backgrounds/vector.svg")
        }));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn tree_reads_legacy_root_folder_metadata_descriptions() {
        let root = temp_root("legacy-root-folder-meta");
        fs::create_dir_all(root.join("music")).expect("create music folder");
        fs::write(
            root.join("meta.json"),
            serde_json::to_vec(&json!({ "music": "Legacy music folder" }))
                .expect("encode legacy metadata"),
        )
        .expect("write legacy root metadata");
        let service = AssetService::new(&root).expect("create asset service");

        let tree = service.tree().expect("read tree");
        let music = tree
            .get("children")
            .and_then(Value::as_array)
            .expect("root children")
            .iter()
            .find(|child| child.get("path").and_then(Value::as_str) == Some("music"))
            .expect("music folder node");

        assert_eq!(
            music.get("description").and_then(Value::as_str),
            Some("Legacy music folder")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_description_updates_root_metadata_without_creating_missing_folders() {
        let root = temp_root("folder-description-root-meta");
        fs::create_dir_all(root.join("music")).expect("create music folder");
        fs::write(
            root.join("music/meta.json"),
            serde_json::to_vec(&json!({ "description": "Stale per-folder description" }))
                .expect("encode folder metadata"),
        )
        .expect("write old folder metadata");
        let service = AssetService::new(&root).expect("create asset service");

        service
            .set_folder_description("music", "  Score cues  ")
            .expect("set folder description");
        let meta: Value =
            serde_json::from_slice(&fs::read(root.join("meta.json")).expect("read root metadata"))
                .expect("decode root metadata");
        assert_eq!(
            meta.get("music").and_then(Value::as_str),
            Some("Score cues")
        );

        service
            .set_folder_description("music", " ")
            .expect("clear folder description");
        assert!(
            !root.join("meta.json").exists(),
            "empty root metadata file should be removed"
        );
        let tree = service
            .tree()
            .expect("read tree after clearing description");
        let music = tree
            .get("children")
            .and_then(Value::as_array)
            .expect("root children")
            .iter()
            .find(|child| child.get("path").and_then(Value::as_str) == Some("music"))
            .expect("music folder node");
        assert!(
            music.get("description").is_none(),
            "cleared description should not fall back to stale per-folder metadata"
        );

        let missing = service
            .set_folder_description("music/missing", "Nope")
            .expect_err("missing folder description should reject");
        assert_eq!(missing.code, "not_found");
        assert!(!root.join("music/missing").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_lifecycle_keeps_root_metadata_on_current_folder_paths() {
        let root = temp_root("folder-metadata-lifecycle");
        fs::create_dir_all(root.join("music/zone/boss")).expect("create removable subtree");
        fs::create_dir_all(root.join("music/scene/deep")).expect("create movable subtree");
        fs::create_dir_all(root.join("ambient")).expect("create target folder");
        fs::write(
            root.join("meta.json"),
            serde_json::to_vec(&json!({
                "music": "Music root",
                "music/zone": "Deleted folder",
                "music/zone/boss": "Deleted child",
                "music/scene": "Scene folder",
                "music/scene/deep": "Scene child"
            }))
            .expect("encode root metadata"),
        )
        .expect("write root metadata");
        let service = AssetService::new(&root).expect("create asset service");

        service
            .remove_folder("music/zone", true)
            .expect("delete described folder subtree");
        fs::create_dir_all(root.join("music/zone")).expect("recreate deleted folder");
        let tree = service.tree().expect("read tree after recreate");
        let music = tree
            .get("children")
            .and_then(Value::as_array)
            .expect("root children")
            .iter()
            .find(|child| child.get("path").and_then(Value::as_str) == Some("music"))
            .expect("music folder node");
        let recreated = music
            .get("children")
            .and_then(Value::as_array)
            .expect("music children")
            .iter()
            .find(|child| child.get("path").and_then(Value::as_str) == Some("music/zone"))
            .expect("recreated folder node");
        assert!(recreated.get("description").is_none());

        service
            .rename("music/scene", "renamed")
            .expect("rename described folder subtree");
        let renamed_meta: Value =
            serde_json::from_slice(&fs::read(root.join("meta.json")).expect("read root metadata"))
                .expect("decode root metadata");
        assert_eq!(
            renamed_meta.get("music/renamed").and_then(Value::as_str),
            Some("Scene folder")
        );
        assert_eq!(
            renamed_meta
                .get("music/renamed/deep")
                .and_then(Value::as_str),
            Some("Scene child")
        );
        assert!(renamed_meta.get("music/zone").is_none());
        assert!(renamed_meta.get("music/zone/boss").is_none());
        assert!(renamed_meta.get("music/scene").is_none());
        assert!(renamed_meta.get("music/scene/deep").is_none());

        service
            .move_to_folder("music/renamed", "ambient")
            .expect("move described folder subtree");
        let moved_meta: Value =
            serde_json::from_slice(&fs::read(root.join("meta.json")).expect("read root metadata"))
                .expect("decode root metadata");
        assert_eq!(
            moved_meta.get("ambient/renamed").and_then(Value::as_str),
            Some("Scene folder")
        );
        assert_eq!(
            moved_meta
                .get("ambient/renamed/deep")
                .and_then(Value::as_str),
            Some("Scene child")
        );
        assert_eq!(
            moved_meta.get("music").and_then(Value::as_str),
            Some("Music root")
        );
        assert!(moved_meta.get("music/renamed").is_none());
        assert!(moved_meta.get("music/renamed/deep").is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn manifest_infers_structured_tags_for_shallow_music_files() {
        let root = temp_root("shallow-music-tags");
        fs::create_dir_all(root.join("music/combat")).expect("create music folder");
        fs::write(root.join("music/combat/battle-epic.mp3"), b"").expect("write music asset");
        let service = AssetService::new(&root).expect("create asset service");

        let manifest = service.manifest().expect("read manifest");
        let assets = manifest
            .get("assets")
            .and_then(serde_json::Value::as_object)
            .expect("manifest assets");

        assert!(assets.contains_key("music:combat:custom:intense:battle-epic"));
        assert!(!assets.contains_key("music:combat:battle-epic"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn manifest_bridges_managed_backgrounds_as_user_background_tags() {
        let sandbox = temp_root("managed-background-bridge");
        let game_root = sandbox.join("game-assets");
        let background_root = sandbox.join("backgrounds");
        fs::create_dir_all(&game_root).expect("create game asset root");
        fs::create_dir_all(&background_root).expect("create background root");
        fs::write(background_root.join("moonlit_lake.jpg"), b"").expect("write background");
        let game_assets = AssetService::new(&game_root).expect("create game assets");
        let backgrounds = AssetService::new(&background_root).expect("create backgrounds");

        let plain_manifest = game_assets.manifest().expect("read plain manifest");
        assert!(plain_manifest
            .get("assets")
            .and_then(serde_json::Value::as_object)
            .expect("plain assets")
            .get("backgrounds:user:moonlit_lake")
            .is_none());

        let merged_manifest = game_assets
            .manifest_with_backgrounds(&backgrounds)
            .expect("read merged manifest");
        let entry = merged_manifest
            .get("assets")
            .and_then(|assets| assets.get("backgrounds:user:moonlit_lake"))
            .expect("bridged background entry");

        assert_eq!(
            entry.get("path").and_then(serde_json::Value::as_str),
            Some("__user_bg__/moonlit_lake.jpg")
        );
        assert_eq!(
            entry.get("category").and_then(serde_json::Value::as_str),
            Some("backgrounds")
        );
        assert_eq!(
            entry
                .get("managedSource")
                .and_then(serde_json::Value::as_str),
            Some("backgrounds")
        );

        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn managed_background_bridge_does_not_overwrite_explicit_game_asset_tags() {
        let sandbox = temp_root("managed-background-bridge-collision");
        let game_root = sandbox.join("game-assets");
        let background_root = sandbox.join("backgrounds");
        fs::create_dir_all(game_root.join("backgrounds/user"))
            .expect("create game background folder");
        fs::create_dir_all(&background_root).expect("create background root");
        fs::write(game_root.join("backgrounds/user/moonlit_lake.jpg"), b"")
            .expect("write game background");
        fs::write(background_root.join("moonlit_lake.jpg"), b"").expect("write managed background");
        let game_assets = AssetService::new(&game_root).expect("create game assets");
        let backgrounds = AssetService::new(&background_root).expect("create backgrounds");

        let merged_manifest = game_assets
            .manifest_with_backgrounds(&backgrounds)
            .expect("read merged manifest");
        let entry = merged_manifest
            .get("assets")
            .and_then(|assets| assets.get("backgrounds:user:moonlit_lake"))
            .expect("background entry");

        assert_eq!(
            entry.get("path").and_then(serde_json::Value::as_str),
            Some("backgrounds/user/moonlit_lake.jpg")
        );

        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn rejects_root_and_native_category_folder_deletion() {
        let root = temp_root("delete-guards");
        fs::create_dir_all(root.join("music")).expect("create music folder");
        fs::write(root.join("music/theme.mp3"), b"").expect("write music asset");
        let service = AssetService::new(&root).expect("create asset service");

        let root_error = service
            .remove_folder("", true)
            .expect_err("root folder deletion should be rejected");
        assert_eq!(root_error.code, "invalid_input");
        assert!(root.exists());

        let category_error = service
            .remove_folder("music", true)
            .expect_err("native category deletion should be rejected");
        assert_eq!(category_error.code, "invalid_input");
        assert!(root.join("music/theme.mp3").exists());

        service
            .remove_file("music/theme.mp3")
            .expect("files inside managed categories remain deletable");
        assert!(!root.join("music/theme.mp3").exists());

        let _ = fs::remove_dir_all(root);
    }
}
