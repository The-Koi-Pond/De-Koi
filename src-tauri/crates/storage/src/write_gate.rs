use marinara_core::{AppError, AppResult};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, ThreadId};

#[derive(Default)]
pub(crate) struct WriteGate {
    state: Mutex<WriteGateState>,
    changed: Condvar,
}

#[derive(Default)]
struct WriteGateState {
    atomic_owner: Option<ThreadId>,
    active_writes: usize,
}

#[derive(Clone, Copy)]
enum WritePermitKind {
    Ordinary,
    Atomic,
}

pub(crate) struct WritePermit {
    gate: Arc<WriteGate>,
    kind: WritePermitKind,
}

impl WriteGate {
    fn state(&self) -> AppResult<MutexGuard<'_, WriteGateState>> {
        self.state
            .lock()
            .map_err(|_| AppError::new("lock_error", "Storage write gate poisoned"))
    }

    pub(crate) fn begin_write(self: &Arc<Self>) -> AppResult<WritePermit> {
        let current = thread::current().id();
        let mut state = self.state()?;
        loop {
            match state.atomic_owner {
                Some(owner) if owner == current => {
                    return Err(AppError::new(
                        "storage_transaction_active",
                        "Storage writes cannot run during an atomic collection update",
                    ));
                }
                Some(_) => {
                    state = self
                        .changed
                        .wait(state)
                        .map_err(|_| AppError::new("lock_error", "Storage write gate poisoned"))?;
                }
                None => break,
            }
        }
        state.active_writes += 1;
        drop(state);
        Ok(WritePermit {
            gate: Arc::clone(self),
            kind: WritePermitKind::Ordinary,
        })
    }

    pub(crate) fn begin_atomic_update(self: &Arc<Self>) -> AppResult<WritePermit> {
        let current = thread::current().id();
        let mut state = self.state()?;
        if state.atomic_owner == Some(current) {
            return Err(AppError::new(
                "storage_transaction_active",
                "Storage atomic update is already active",
            ));
        }
        while state.atomic_owner.is_some() || state.active_writes > 0 {
            state = self
                .changed
                .wait(state)
                .map_err(|_| AppError::new("lock_error", "Storage write gate poisoned"))?;
        }
        state.atomic_owner = Some(current);
        drop(state);
        Ok(WritePermit {
            gate: Arc::clone(self),
            kind: WritePermitKind::Atomic,
        })
    }

    pub(crate) fn atomic_update_active(&self) -> AppResult<bool> {
        Ok(self.state()?.atomic_owner.is_some())
    }
}

impl Drop for WritePermit {
    fn drop(&mut self) {
        let mut state = self
            .gate
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match self.kind {
            WritePermitKind::Ordinary => {
                state.active_writes = state.active_writes.saturating_sub(1);
            }
            WritePermitKind::Atomic => {
                state.atomic_owner = None;
            }
        }
        self.gate.changed.notify_all();
    }
}
