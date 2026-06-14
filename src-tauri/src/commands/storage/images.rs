use super::shared::*;
use super::*;

#[path = "images/providers.rs"]
mod providers;

pub(crate) use providers::{
    automatic1111_sdapi_url as image_sdapi_url, connection_base_url as image_connection_base_url,
    generate_image_with_connection, generate_image_with_options, image_extension_from_mime_type,
    image_model as image_generation_model, image_source as image_generation_source,
    is_openai_gpt_image_model, ImageGenerationOptions,
};

pub(crate) fn avatar_generation_prompt_id(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    format!("avatar-{}", slug.trim_matches('-'))
}

pub(crate) fn avatar_generation_prompt(body: &Value) -> String {
    let name = body
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Character");
    let appearance = body
        .get("appearance")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("distinctive character portrait");
    format!(
        "Portrait avatar of {name}. {appearance}. Centered bust portrait, expressive face, clean background, high detail, polished character art."
    )
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ImagePromptDefaults {
    prompt_prefix: String,
    negative_prompt_prefix: String,
    style_profile_id: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct AvatarStyleProfile {
    positive_tags: String,
    negative_tags: String,
    avatar_subject_tags: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AvatarPromptCompilation {
    id: String,
    title: String,
    prompt: String,
    negative_prompt: Option<String>,
}

fn default_parameters_root(connection: &Value) -> Option<Value> {
    match connection.get("defaultParameters")? {
        Value::String(raw) => serde_json::from_str::<Value>(raw).ok(),
        Value::Object(_) => connection.get("defaultParameters").cloned(),
        _ => None,
    }
}

fn image_defaults_profile(connection: &Value, service: &str) -> Option<Value> {
    let profile = default_parameters_root(connection)?
        .get("imageGeneration")
        .cloned()?;
    profile
        .get("service")
        .and_then(Value::as_str)
        .filter(|value| *value == service)?;
    Some(profile)
}

fn defaults_service_for_connection(connection: &Value) -> Option<&'static str> {
    match image_generation_source(connection).as_str() {
        "automatic1111" | "drawthings" => Some("automatic1111"),
        "comfyui" | "runpod_comfyui" => Some("comfyui"),
        "novelai" => Some("novelai"),
        _ => None,
    }
}

fn image_prompt_defaults(connection: &Value) -> ImagePromptDefaults {
    let Some(service) = defaults_service_for_connection(connection) else {
        return ImagePromptDefaults::default();
    };
    let Some(profile) = image_defaults_profile(connection, service) else {
        return ImagePromptDefaults::default();
    };
    let style_profile_id = profile
        .get("styleProfileId")
        .and_then(Value::as_str)
        .map(slug_image_style_profile_id)
        .filter(|value| !value.is_empty());
    let Some(defaults) = profile.get(service).and_then(Value::as_object) else {
        return ImagePromptDefaults {
            style_profile_id,
            ..ImagePromptDefaults::default()
        };
    };
    ImagePromptDefaults {
        prompt_prefix: defaults
            .get("promptPrefix")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        negative_prompt_prefix: defaults
            .get("negativePromptPrefix")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        style_profile_id,
    }
}

fn selected_avatar_style_profile(
    body: &Value,
    connection_defaults: &ImagePromptDefaults,
) -> AvatarStyleProfile {
    let settings = body.get("styleProfiles");
    let selected_id = body
        .get("styleProfileId")
        .and_then(Value::as_str)
        .map(slug_image_style_profile_id)
        .filter(|value| !value.is_empty())
        .or_else(|| connection_defaults.style_profile_id.clone())
        .or_else(|| {
            settings
                .and_then(|value| value.get("defaultProfileId"))
                .and_then(Value::as_str)
                .map(slug_image_style_profile_id)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| "auto".to_string());

    settings
        .and_then(|value| value.get("profiles"))
        .and_then(Value::as_array)
        .and_then(|profiles| {
            profiles.iter().find_map(|profile| {
                let id = profile.get("id").and_then(Value::as_str)?;
                if slug_image_style_profile_id(id) != selected_id {
                    return None;
                }
                let subject_tags = profile
                    .get("subjectTags")
                    .and_then(|value| value.get("avatar"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                Some(AvatarStyleProfile {
                    positive_tags: profile
                        .get("positiveTags")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                    negative_tags: profile
                        .get("negativeTags")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                    avatar_subject_tags: subject_tags,
                })
            })
        })
        .unwrap_or_else(|| built_in_avatar_style_profile(&selected_id))
}

fn built_in_avatar_style_profile(profile_id: &str) -> AvatarStyleProfile {
    match profile_id {
        "anime" => AvatarStyleProfile {
            positive_tags: "anime style, illustration, best quality, detailed eyes, clean lineart".to_string(),
            negative_tags:
                "photorealistic, 3d render, lowres, bad anatomy, bad hands, text, watermark, logo, signature"
                    .to_string(),
            avatar_subject_tags: "solo, portrait, upper body, centered composition".to_string(),
        },
        "danbooru" => AvatarStyleProfile {
            positive_tags: "masterpiece, best quality, absurdres, anime screencap, detailed eyes".to_string(),
            negative_tags:
                "worst quality, low quality, lowres, bad anatomy, bad hands, extra digits, fewer digits, text, watermark, logo, signature"
                    .to_string(),
            avatar_subject_tags: "solo, portrait, upper body, centered composition".to_string(),
        },
        "realistic" => AvatarStyleProfile {
            positive_tags: "high quality, realistic, detailed, natural lighting".to_string(),
            negative_tags:
                "anime, cartoon, illustration, low quality, blurry, plastic skin, text, watermark, logo, signature"
                    .to_string(),
            avatar_subject_tags: "single subject, centered portrait, readable face".to_string(),
        },
        "photorealistic" => AvatarStyleProfile {
            positive_tags: "photorealistic, high quality, sharp focus, natural lighting, detailed textures".to_string(),
            negative_tags:
                "anime, cartoon, illustration, painting, plastic skin, uncanny face, low quality, blurry, text, watermark, logo, signature"
                    .to_string(),
            avatar_subject_tags: "single subject, centered face-and-shoulders portrait".to_string(),
        },
        "cinematic" => AvatarStyleProfile {
            positive_tags: "cinematic lighting, dramatic composition, atmospheric, high detail".to_string(),
            negative_tags: "flat lighting, cluttered composition, text, watermark, logo, signature, low quality".to_string(),
            avatar_subject_tags: "single subject, centered portrait".to_string(),
        },
        "digital-painting" | "digital_painting" => AvatarStyleProfile {
            positive_tags: "digital painting, concept art, refined brushwork, high detail, designed lighting".to_string(),
            negative_tags:
                "photograph, raw photo, muddy details, flat lighting, text, watermark, logo, signature, low quality"
                    .to_string(),
            avatar_subject_tags: "single subject, centered character portrait".to_string(),
        },
        "painterly" => AvatarStyleProfile {
            positive_tags: "painterly, fantasy illustration, soft brushwork, rich atmosphere, high detail".to_string(),
            negative_tags: "photorealistic, flat colors, muddy details, text, watermark, logo, signature, low quality"
                .to_string(),
            avatar_subject_tags: "single subject, centered portrait, painterly avatar".to_string(),
        },
        "z-image-turbo" | "z_image_turbo" => AvatarStyleProfile {
            positive_tags: "A clean avatar portrait with a clear silhouette and readable face.".to_string(),
            negative_tags: "text, watermark, logo, signature, low quality, blurry, malformed hands, distorted face"
                .to_string(),
            avatar_subject_tags: String::new(),
        },
        _ => AvatarStyleProfile {
            positive_tags: String::new(),
            negative_tags: "text, watermark, logo, signature, low quality, blurry".to_string(),
            avatar_subject_tags: String::new(),
        },
    }
}

fn slug_image_style_profile_id(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(80)
        .collect()
}

fn merge_prompt_prefix(prefix: &str, prompt: &str) -> String {
    let prefix = prefix.trim();
    let prompt = prompt.trim();
    match (prefix.is_empty(), prompt.is_empty()) {
        (true, _) => prompt.to_string(),
        (_, true) => prefix.to_string(),
        _ => format!("{prefix}, {prompt}"),
    }
}

fn avatar_prompt_compilation(body: &Value, connection: &Value) -> AvatarPromptCompilation {
    let name = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Character");
    let defaults = image_prompt_defaults(connection);
    let style_profile = selected_avatar_style_profile(body, &defaults);
    let prompt = [
        style_profile.positive_tags.as_str(),
        style_profile.avatar_subject_tags.as_str(),
        defaults.prompt_prefix.as_str(),
        &avatar_generation_prompt(body),
    ]
    .into_iter()
    .fold(String::new(), |current, part| {
        merge_prompt_prefix(&current, part)
    });
    let negative_prompt = merge_prompt_prefix(
        style_profile.negative_tags.as_str(),
        &merge_prompt_prefix(
            defaults.negative_prompt_prefix.as_str(),
            body.get("negativePrompt")
                .or_else(|| body.get("negative_prompt"))
                .and_then(Value::as_str)
                .unwrap_or(""),
        ),
    );

    AvatarPromptCompilation {
        id: avatar_generation_prompt_id(name),
        title: format!("Avatar: {}", name.trim().if_empty("Character")),
        prompt,
        negative_prompt: (!negative_prompt.trim().is_empty()).then_some(negative_prompt),
    }
}

pub(crate) fn image_dimension(body: &Value, key: &str, fallback: u64) -> u64 {
    body.get(key)
        .and_then(Value::as_u64)
        .filter(|value| (128..=4096).contains(value))
        .unwrap_or(fallback)
}

pub(crate) fn avatar_generation_preview(state: &AppState, body: Value) -> AppResult<Value> {
    let connection_id = required_string(&body, "connectionId")?;
    let connection = connection_secrets::connection_for_runtime(state, connection_id)?;
    if connection.get("provider").and_then(Value::as_str) != Some("image_generation") {
        return Err(AppError::invalid_input(
            "Selected connection is not an image-generation connection",
        ));
    }
    let compiled = avatar_prompt_compilation(&body, &connection);
    Ok(json!({
        "items": [{
            "id": compiled.id,
            "kind": "avatar",
            "title": compiled.title,
            "prompt": compiled.prompt,
            "negativePrompt": compiled.negative_prompt,
            "width": image_dimension(&body, "width", 768),
            "height": image_dimension(&body, "height", 1024)
        }]
    }))
}

trait EmptyFallback {
    fn if_empty<'a>(&'a self, fallback: &'a str) -> &'a str;
}

impl EmptyFallback for str {
    fn if_empty<'a>(&'a self, fallback: &'a str) -> &'a str {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ImagePromptOverride {
    pub(crate) prompt: String,
    pub(crate) negative_prompt: Option<String>,
    pub(crate) has_negative_prompt: bool,
}

pub(crate) fn image_prompt_override(body: &Value, id: &str) -> Option<ImagePromptOverride> {
    body.get("promptOverrides")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                let item_id = item.get("id").and_then(Value::as_str)?;
                let prompt = item.get("prompt").and_then(Value::as_str)?.trim();
                if item_id == id && !prompt.is_empty() {
                    let negative_value = item
                        .get("negativePrompt")
                        .or_else(|| item.get("negative_prompt"));
                    let negative_prompt = negative_value.and_then(Value::as_str);
                    Some(ImagePromptOverride {
                        prompt: prompt.to_string(),
                        negative_prompt: negative_prompt
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string),
                        has_negative_prompt: negative_prompt.is_some(),
                    })
                } else {
                    None
                }
            })
        })
}

pub(crate) fn prompt_override(body: &Value, id: &str) -> Option<String> {
    image_prompt_override(body, id).map(|item| item.prompt)
}

pub(crate) fn negative_prompt_override(body: &Value, id: &str) -> Option<String> {
    image_prompt_override(body, id).and_then(|item| {
        if item.has_negative_prompt {
            Some(item.negative_prompt.unwrap_or_default())
        } else {
            None
        }
    })
}

pub(crate) fn image_generation_options(body: &Value) -> ImageGenerationOptions {
    let negative_prompt = body
        .get("negativePrompt")
        .or_else(|| body.get("negative_prompt"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mut reference_images = Vec::new();
    if let Some(value) = body.get("referenceImage").and_then(Value::as_str) {
        if !value.trim().is_empty() {
            reference_images.push(value.trim().to_string());
        }
    }
    if let Some(items) = body.get("referenceImages").and_then(Value::as_array) {
        reference_images.extend(
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        );
    }
    ImageGenerationOptions {
        negative_prompt,
        reference_images,
        transparent_background: body
            .get("transparentBackground")
            .or_else(|| body.get("transparent_background"))
            .or_else(|| body.get("nativeTransparentPng"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        apply_prompt_defaults: true,
    }
}

pub(crate) fn percent_encode_component(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => {
                encoded.push('%');
                encoded.push(HEX[(byte >> 4) as usize] as char);
                encoded.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }
    encoded
}

pub(crate) async fn avatar_generation(state: &AppState, body: Value) -> AppResult<Value> {
    let connection_id = required_string(&body, "connectionId")?;
    let connection = connection_secrets::connection_for_runtime(state, connection_id)?;
    if connection.get("provider").and_then(Value::as_str) != Some("image_generation") {
        return Err(AppError::invalid_input(
            "Selected connection is not an image-generation connection",
        ));
    }
    let compiled = avatar_prompt_compilation(&body, &connection);
    let prompt = prompt_override(&body, &compiled.id).unwrap_or_else(|| compiled.prompt.clone());
    let negative_prompt =
        negative_prompt_override(&body, &compiled.id).or(compiled.negative_prompt);
    let width = image_dimension(&body, "width", 768);
    let height = image_dimension(&body, "height", 1024);
    let mut options = image_generation_options(&body);
    options.negative_prompt = negative_prompt;
    options.apply_prompt_defaults = false;
    let (base64, mime_type) =
        generate_image_with_options(&connection, &prompt, width, height, options).await?;
    let ext = image_extension_from_mime_type(&mime_type);
    Ok(json!({
        "image": format!("data:{mime_type};base64,{base64}"),
        "base64": base64,
        "mimeType": mime_type,
        "ext": ext,
        "prompt": prompt
    }))
}

pub(crate) async fn generate_image(state: &AppState, body: Value) -> AppResult<Value> {
    let connection_id = required_string(&body, "connectionId")?;
    let prompt = required_string(&body, "prompt")?;
    let width = image_dimension(&body, "width", 1024);
    let height = image_dimension(&body, "height", 1024);
    let connection = connection_secrets::connection_for_runtime(state, connection_id)?;
    let provider = image_generation_source(&connection);
    let model = image_generation_model(&connection, &provider);
    let (base64, mime_type) = generate_image_with_options(
        &connection,
        prompt,
        width,
        height,
        image_generation_options(&body),
    )
    .await?;
    let ext = image_extension_from_mime_type(&mime_type);
    Ok(json!({
        "base64": base64,
        "mimeType": mime_type,
        "ext": ext,
        "image": format!("data:{mime_type};base64,{base64}"),
        "provider": provider,
        "model": model
    }))
}

pub(crate) async fn test_image_generation(state: &AppState, id: &str) -> AppResult<Value> {
    let connection = connection_secrets::connection_for_runtime(state, id)?;
    if connection.get("provider").and_then(Value::as_str) != Some("image_generation") {
        return Err(AppError::invalid_input(
            "Not an image-generation connection",
        ));
    }
    let prompt = "plate of spaghetti with marinara sauce";
    let start = now_millis();
    match generate_image_with_connection(&connection, prompt, 512, 512).await {
        Ok((base64, mime_type)) => Ok(json!({
            "success": true,
            "base64": base64,
            "mimeType": mime_type,
            "ext": image_extension_from_mime_type(&mime_type),
            "latencyMs": now_millis() - start,
            "prompt": prompt
        })),
        Err(error) => Ok(json!({
            "success": false,
            "base64": Value::Null,
            "mimeType": Value::Null,
            "latencyMs": now_millis() - start,
            "prompt": prompt,
            "error": error.message
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn avatar_prompt_compilation_applies_connection_style_profile_and_prompt_defaults() {
        let body = json!({
            "name": "Mira",
            "appearance": "silver hair, green eyes",
            "negativePrompt": "bad hands",
            "styleProfiles": {
                "defaultProfileId": "auto",
                "profiles": [
                    {
                        "id": "danbooru",
                        "positiveTags": "masterpiece, best quality",
                        "negativeTags": "worst quality, low quality",
                        "subjectTags": { "avatar": "solo, portrait, upper body" }
                    }
                ]
            }
        });
        let connection = json!({
            "provider": "image_generation",
            "imageGenerationSource": "novelai",
            "defaultParameters": {
                "imageGeneration": {
                    "service": "novelai",
                    "styleProfileId": "danbooru",
                    "novelai": {
                        "promptPrefix": "best quality",
                        "negativePromptPrefix": "low quality"
                    }
                }
            }
        });

        let compiled = avatar_prompt_compilation(&body, &connection);

        assert_eq!(compiled.id, "avatar-mira");
        assert!(compiled.prompt.contains("masterpiece"));
        assert!(compiled.prompt.contains("solo, portrait, upper body"));
        assert!(compiled.prompt.contains("Portrait avatar of Mira"));
        assert!(compiled.prompt.contains("silver hair, green eyes"));
        let negative_prompt = compiled.negative_prompt.as_deref().unwrap_or("");
        assert!(negative_prompt.contains("worst quality"));
        assert!(negative_prompt.ends_with("low quality, bad hands"));
    }

    #[test]
    fn image_dimension_accepts_documented_4096_cap() {
        let body = json!({ "width": 4096, "height": 4097 });

        assert_eq!(image_dimension(&body, "width", 1024), 4096);
        assert_eq!(image_dimension(&body, "height", 1024), 1024);
    }

    #[test]
    fn negative_prompt_override_preserves_empty_review_value() {
        let body = json!({
            "promptOverrides": [{
                "id": "avatar-mira",
                "prompt": "reviewed positive prompt",
                "negativePrompt": ""
            }]
        });

        assert_eq!(
            negative_prompt_override(&body, "avatar-mira"),
            Some(String::new())
        );
    }

    #[test]
    fn image_prompt_override_preserves_negative_prompt_presence() {
        let body = json!({
            "promptOverrides": [
                { "id": "keep", "prompt": "new prompt", "negativePrompt": " bad anatomy " },
                { "id": "clear", "prompt": "clear prompt", "negativePrompt": "" },
                { "id": "null", "prompt": "null prompt", "negativePrompt": null }
            ]
        });

        let keep = image_prompt_override(&body, "keep").expect("override should exist");
        assert_eq!(keep.prompt, "new prompt");
        assert_eq!(keep.negative_prompt, Some("bad anatomy".to_string()));
        assert!(keep.has_negative_prompt);

        let clear = image_prompt_override(&body, "clear").expect("override should exist");
        assert_eq!(clear.prompt, "clear prompt");
        assert_eq!(clear.negative_prompt, None);
        assert!(clear.has_negative_prompt);

        let null = image_prompt_override(&body, "null").expect("override should exist");
        assert_eq!(null.prompt, "null prompt");
        assert_eq!(null.negative_prompt, None);
        assert!(!null.has_negative_prompt);
    }
}
