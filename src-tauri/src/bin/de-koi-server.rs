use de_koi_lib::http_server;
use de_koi_lib::state::AppState;
use std::net::SocketAddr;
use std::path::PathBuf;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("de-koi-server failed: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = env_var("DE_KOI_SERVER_ADDR", "MARINARA_SERVER_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8787".to_string())
        .parse()?;
    let data_dir = env_var("DE_KOI_DATA_DIR", "MARINARA_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("de-koi-server-data")
        });
    let state = AppState::from_data_dir_with_resource_dir(
        data_dir,
        AppState::server_default_roots(),
        AppState::server_resource_dir(),
    )?;
    println!("de-koi-server listening on http://{addr}");
    http_server::serve(state, addr).await?;
    Ok(())
}

fn env_var(primary: &str, legacy: &str) -> Result<String, std::env::VarError> {
    std::env::var(primary).or_else(|_| std::env::var(legacy))
}
