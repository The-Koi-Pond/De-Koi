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
    exclusive_owner: Option<ThreadId>,
    active_writes: usize,
    waiting_atomic_updates: usize,
    waiting_exclusive_sections: usize,
    recovery_required: bool,
}

impl WriteGateState {
    fn excluded(&self, current: ThreadId) -> bool {
        self.exclusive_owner.is_some_and(|owner| owner != current)
    }
}

#[derive(Clone, Copy)]
enum WritePermitKind {
    Ordinary,
    Atomic,
    Exclusive,
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
                None if state.excluded(current) || state.active_writes > 0 => {
                    state = self
                        .changed
                        .wait(state)
                        .map_err(|_| AppError::new("lock_error", "Storage write gate poisoned"))?;
                }
                // Queued atomic updates and exclusive sections go before later
                // ordinary writes, except writes made by the exclusive owner.
                None if state.exclusive_owner != Some(current)
                    && (state.waiting_atomic_updates > 0 || state.waiting_exclusive_sections > 0) =>
                {
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
        state.waiting_atomic_updates = state.waiting_atomic_updates.saturating_add(1);
        while state.atomic_owner.is_some() || state.active_writes > 0 || state.excluded(current) {
            state = self
                .changed
                .wait(state)
                .map_err(|_| AppError::new("lock_error", "Storage write gate poisoned"))?;
            if state.recovery_required {
                state.waiting_atomic_updates = state.waiting_atomic_updates.saturating_sub(1);
                self.changed.notify_all();
                return Err(Self::recovery_required_error());
            }
        }
        state.waiting_atomic_updates = state.waiting_atomic_updates.saturating_sub(1);
        state.atomic_owner = Some(current);
        drop(state);
        Ok(WritePermit {
            gate: Arc::clone(self),
            kind: WritePermitKind::Atomic,
        })
    }

    /// Starts a section in which only the calling thread may write. The
    /// owner's ordinary writes and atomic updates proceed as usual; every other
    /// thread's writes wait until the returned permit is dropped. Use it when a
    /// check and the writes it guards must see no intervening mutation.
    pub(crate) fn begin_exclusive(self: &Arc<Self>) -> AppResult<WritePermit> {
        let current = thread::current().id();
        let mut state = self.state()?;
        if state.recovery_required {
            return Err(Self::recovery_required_error());
        }
        if state.exclusive_owner == Some(current) || state.atomic_owner == Some(current) {
            return Err(AppError::new(
                "storage_transaction_active",
                "Storage exclusive section cannot start inside another storage transaction",
            ));
        }
        state.waiting_exclusive_sections = state.waiting_exclusive_sections.saturating_add(1);
        while state.exclusive_owner.is_some() || state.atomic_owner.is_some() || state.active_writes > 0 {
            state = self
                .changed
                .wait(state)
                .map_err(|_| AppError::new("lock_error", "Storage write gate poisoned"))?;
            if state.recovery_required {
                state.waiting_exclusive_sections = state.waiting_exclusive_sections.saturating_sub(1);
                self.changed.notify_all();
                return Err(Self::recovery_required_error());
            }
        }
        state.waiting_exclusive_sections = state.waiting_exclusive_sections.saturating_sub(1);
        state.exclusive_owner = Some(current);
        drop(state);
        Ok(WritePermit {
            gate: Arc::clone(self),
            kind: WritePermitKind::Exclusive,
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
            WritePermitKind::Exclusive => {
                state.exclusive_owner = None;
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

    #[test]
    fn exclusive_section_blocks_other_writers_but_not_its_owner() {
        let gate = Arc::new(WriteGate::default());
        let exclusive = gate.begin_exclusive().unwrap();

        drop(gate.begin_write().expect("the owner keeps writing"));
        drop(gate.begin_atomic_update().expect("the owner keeps atomic updates"));

        let other_gate = Arc::clone(&gate);
        let (acquired_tx, acquired_rx) = mpsc::channel();
        let other = std::thread::spawn(move || {
            let permit = other_gate.begin_write().unwrap();
            acquired_tx.send(()).unwrap();
            drop(permit);
        });
        assert!(
            acquired_rx.recv_timeout(Duration::from_millis(100)).is_err(),
            "another thread must not write during the exclusive section"
        );

        drop(exclusive);
        acquired_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("other writers continue after the section ends");
        other.join().unwrap();
    }

    #[test]
    fn exclusive_sections_do_not_nest() {
        let gate = Arc::new(WriteGate::default());
        let _exclusive = gate.begin_exclusive().unwrap();

        assert_eq!(
            gate.begin_exclusive().map(drop).unwrap_err().code,
            "storage_transaction_active"
        );
    }

    #[test]
    fn queued_atomic_update_runs_before_later_ordinary_writes() {
        let gate = Arc::new(WriteGate::default());
        let active = gate.begin_write().unwrap();
        let atomic_gate = Arc::clone(&gate);
        let (atomic_started_tx, atomic_started_rx) = mpsc::channel();
        let (atomic_acquired_tx, atomic_acquired_rx) = mpsc::channel();
        let (release_atomic_tx, release_atomic_rx) = mpsc::channel();
        let atomic = std::thread::spawn(move || {
            atomic_started_tx.send(()).unwrap();
            let permit = atomic_gate.begin_atomic_update().unwrap();
            atomic_acquired_tx.send(()).unwrap();
            release_atomic_rx.recv().unwrap();
            drop(permit);
        });
        atomic_started_rx.recv().unwrap();

        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while gate.state().unwrap().waiting_atomic_updates == 0 {
            assert!(
                std::time::Instant::now() < deadline,
                "atomic update must register as waiting"
            );
            std::thread::yield_now();
        }

        let ordinary_gate = Arc::clone(&gate);
        let (ordinary_acquired_tx, ordinary_acquired_rx) = mpsc::channel();
        let ordinary = std::thread::spawn(move || {
            let permit = ordinary_gate.begin_write().unwrap();
            ordinary_acquired_tx.send(()).unwrap();
            drop(permit);
        });

        drop(active);
        atomic_acquired_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("queued atomic update must receive the next permit");
        assert!(
            ordinary_acquired_rx
                .recv_timeout(Duration::from_millis(100))
                .is_err(),
            "later ordinary writes must not overtake a queued atomic update"
        );

        release_atomic_tx.send(()).unwrap();
        ordinary_acquired_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("ordinary write must continue after the atomic update");
        atomic.join().unwrap();
        ordinary.join().unwrap();
    }
}
