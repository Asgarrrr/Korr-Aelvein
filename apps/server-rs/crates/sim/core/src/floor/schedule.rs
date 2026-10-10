use alloc::collections::BinaryHeap;
use core::cmp::Reverse;

use korr_ecs::{EntityId, Handle};

use crate::time::Tick;

/// Due actors in `(Tick, EntityId)` order. One entry per entity, so the
/// handle never decides.
#[derive(Debug, Default)]
pub(crate) struct Schedule(BinaryHeap<Reverse<(Tick, EntityId, Handle)>>);

impl Schedule {
    pub(crate) fn push(&mut self, at: Tick, id: EntityId, h: Handle) {
        self.0.push(Reverse((at, id, h)));
    }

    pub(crate) fn pop_before(&mut self, end: Tick) -> Option<(Tick, EntityId, Handle)> {
        let Reverse(next) = self.0.peek()?;
        if next.0 < end {
            self.0.pop().map(|Reverse(entry)| entry)
        } else {
            None
        }
    }
}
