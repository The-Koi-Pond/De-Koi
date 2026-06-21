fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let profile = std::env::var("PROFILE").unwrap_or_default();

    if let Some(commit) = source_commit() {
        println!("cargo:rustc-env=DE_KOI_SOURCE_COMMIT={commit}");
    }

    // Windows debug builds get a small default main-thread stack. With the refactor,
    // the app exposes enough Tauri commands that the generated invoke handler can
    // overflow that stack while handling early frontend invokes.
    if target_os == "windows" && profile == "debug" {
        if target_env == "msvc" {
            println!("cargo:rustc-link-arg-bin=de-koi=/STACK:16777216");
        } else {
            println!("cargo:rustc-link-arg-bin=de-koi=-Wl,--stack,16777216");
        }
    }

    #[cfg(feature = "desktop")]
    tauri_build::build();
}

fn source_commit() -> Option<String> {
    ["DE_KOI_SOURCE_COMMIT", "GITHUB_SHA"]
        .iter()
        .find_map(|name| valid_git_sha(std::env::var(name).ok()?.trim()))
        .or_else(git_head_commit)
}

fn git_head_commit() -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    valid_git_sha(std::str::from_utf8(&output.stdout).ok()?.trim())
}

fn valid_git_sha(value: &str) -> Option<String> {
    let is_valid =
        matches!(value.len(), 7..=40) && value.bytes().all(|byte| byte.is_ascii_hexdigit());
    is_valid.then(|| value.to_ascii_lowercase())
}
