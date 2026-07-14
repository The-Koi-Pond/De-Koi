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
    recovery_required: bool,
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
    fn recovery_required_error() -> AppError {
        AppError::new(
            "storage_append_journal_recovery_required",
            "Collection append recovery failed; restart De-Koi after preserving the storage files for recovery",
        )
    }

    fn state(&self) -> AppResult<MutexGuard<'_, WriteGateState>> {
        self.state
            .lock()
            .map_err(|_| AppError::new("lock_error", "Storage write gate poisoned"))
    }

    pub(crate) fn begin_write(self: &Arc<Self>) -> AppResult<WritePermit> {
        let current = thread::current().id();
        let mut state = self.state()?;
        loop {
            if state.recovery_required {
                return Err(Self::recovery_required_error());
            }
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
                None if state.active_writes > 0 => {
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
        if state.recovery_required {
            return Err(Self::recovery_required_error());
        }
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
            if state.recovery_required {
                return Err(Self::recovery_required_error());
            }
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

    pub(crate) fn ensure_available(&self) -> AppResult<()> {
        if self.state()?.recovery_required {
            return Err(Self::recovery_required_error());
        }
        Ok(())
    }

    pub(crate) fn mark_recovery_required(&self) -> AppResult<()> {
        let mut state = self.state()?;
        state.recovery_required = true;
        self.changed.notify_all();
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn queued_writer_observes_recovery_poison_before_receiving_a_permit() {
        let gate = Arc::new(WriteGate::default());
        let active = gate.begin_write().unwrap();
        let waiting_gate = Arc::clone(&gate);
        let (started_tx, started_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        let waiter = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            let result = waiting_gate
                .begin_write()
                .map(drop)
                .map_err(|error| error.code);
            result_tx.send(result).unwrap();
        });
        started_rx.recv().unwrap();

        assert!(result_rx.recv_timeout(Duration::from_millis(100)).is_err());
        gate.mark_recovery_required().unwrap();
        drop(active);

        assert_eq!(
            result_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            Err("storage_append_journal_recovery_required".to_string())
        );
        waiter.join().unwrap();
    }
}
