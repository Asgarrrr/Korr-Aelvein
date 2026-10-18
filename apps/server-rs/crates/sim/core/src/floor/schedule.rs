use alloc::collections::BinaryHeap;
use core::cmp::{Ordering, Reverse};

use korr_ecs::{EntityId, Handle};

use crate::time::Tick;

/// Due actors in `(Tick, EntityId)` order.
#[derive(Debug, Default)]
pub(crate) struct Schedule(BinaryHeap<Reverse<Due>>);

/// Ordered without the handle: slot order follows recycling history.
#[derive(Debug)]
struct Due {
    at: Tick,
    id: EntityId,
    h: Handle,
}

impl Ord for Due {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.at, self.id).cmp(&(other.at, other.id))
    }
}

impl PartialOrd for Due {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Due {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}

impl Eq for Due {}

impl Schedule {
    pub(crate) fn push(&mut self, at: Tick, id: EntityId, h: Handle) {
        self.0.push(Reverse(Due { at, id, h }));
    }

    pub(crate) fn pop_before(&mut self, end: Tick) -> Option<(Tick, EntityId, Handle)> {
        let Reverse(next) = self.0.peek()?;
        if next.at < end {
            self.0.pop().map(|Reverse(Due { at, id, h })| (at, id, h))
        } else {
            None
        }
    }
}
