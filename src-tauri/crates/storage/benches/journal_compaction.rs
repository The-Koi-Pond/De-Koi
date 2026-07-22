use marinara_storage::FileStorage;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

fn temporary_root(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should follow the epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "marinara-storage-journal-compaction-{label}-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&root).expect("benchmark storage root should be created");
    root
}

fn seed_large_collection(storage: &FileStorage, rows: usize) {
    storage
        .replace_all(
            "characters",
            (0..rows)
                .map(|index| {
                    json!({
                        "id": format!("character-{index}"),
                        "name": format!("Character {index}"),
                        "payload": "x".repeat(512),
                    })
                })
                .collect(),
        )
        .expect("benchmark fixture should be written");
}

fn benchmark_storage(root: &PathBuf, compactions: Arc<AtomicUsize>) -> FileStorage {
    FileStorage::new_for_journal_compaction_benchmark(root, compactions)
        .expect("benchmark storage should open")
}

fn run_eager_compaction(rows: usize, patches: usize) -> std::time::Duration {
    let root = temporary_root("eager");
    let compactions = Arc::new(AtomicUsize::new(0));
    let storage = benchmark_storage(&root, compactions.clone());
    seed_large_collection(&storage, rows);
    let started = Instant::now();
    for index in 0..patches {
        storage
            .patch(
                "characters",
                &format!("character-{}", index % rows),
                json!({ "benchmarkPatch": index }),
            )
            .expect("patch should succeed");
        storage.flush().expect("eager compaction should succeed");
    }
    assert_eq!(compactions.load(Ordering::SeqCst), patches);
    let elapsed = started.elapsed();
    drop(storage);
    fs::remove_dir_all(root).expect("benchmark storage root should be removed");
    elapsed
}

fn run_journal_backed_burst(rows: usize, patches: usize) -> std::time::Duration {
    let root = temporary_root("journal-burst");
    let compactions = Arc::new(AtomicUsize::new(0));
    let storage = benchmark_storage(&root, compactions.clone());
    seed_large_collection(&storage, rows);
    let primary = root.join("collections").join("characters.json");
    let journal = root.join("collections").join("characters.pending.jsonl");
    let primary_before = fs::read(&primary).expect("seeded primary should be readable");
    let started = Instant::now();
    for index in 0..patches {
        storage
            .patch(
                "characters",
                &format!("character-{}", index % rows),
                json!({ "benchmarkPatch": index }),
            )
            .expect("patch should succeed");
    }
    assert_eq!(fs::read(&primary).unwrap(), primary_before);
    assert!(
        journal.exists(),
        "burst must remain journal-backed before final flush"
    );
    assert_eq!(compactions.load(Ordering::SeqCst), 0);
    storage.flush().expect("shutdown compaction should succeed");
    assert_eq!(compactions.load(Ordering::SeqCst), 1);
    assert!(
        !journal.exists(),
        "final flush should consume the validated journal"
    );
    let elapsed = started.elapsed();
    drop(storage);
    fs::remove_dir_all(root).expect("benchmark storage root should be removed");
    elapsed
}

fn main() {
    let smoke = std::env::var_os("MARINARA_STORAGE_BENCH_SMOKE").is_some();
    let (rows, patches) = if smoke { (512, 8) } else { (10_000, 64) };
    let eager = run_eager_compaction(rows, patches);
    let journal_backed = run_journal_backed_burst(rows, patches);
    println!(
        "journal compaction benchmark: rows={rows}, patches={patches}, eager={eager:?}, journal_backed={journal_backed:?}"
    );
}
