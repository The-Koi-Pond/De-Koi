//! Process-wide "this collection's data changed" hook.
//!
//! The hosted server installs one listener and streams the collection names to connected clients, so a second
//! device showing the same chat refreshes when the first one writes. Writers call [`collection_changed`] after a
//! durable data change lands (journal append, transaction commit, immediate rewrite, replacement install,
//! streaming rewrite). Background flushes of already-journaled data do not call it.

use std::sync::OnceLock;

type Listener = Box<dyn Fn(&str) + Send + Sync>;

static LISTENER: OnceLock<Listener> = OnceLock::new();

/// Installs the process-wide listener. Returns false if one was already installed. The listener runs on the
/// writing thread while storage locks may be held, so it must not block or touch storage.
pub fn set_collection_change_listener(listener: impl Fn(&str) + Send + Sync + 'static) -> bool {
    LISTENER.set(Box::new(listener)).is_ok()
}

pub(crate) fn collection_changed(collection: &str) {
    if let Some(listener) = LISTENER.get() {
        listener(collection);
    }
}
