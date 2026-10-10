//! Generational slots on a LIFO free list follow thunderdome 0.6.1 and hecs
//! 0.11.2 (MIT OR Apache-2.0). Both wrap the generation; here a slot retires.

use alloc::vec::Vec;

use crate::id::{EntityId, Handle};

struct Meta {
    generation: u32,
    id: Option<EntityId>,
}

#[derive(Default)]
pub(crate) struct Entities {
    metas: Vec<Meta>,
    free: Vec<u32>,
    alive: usize,
}

impl Entities {
    pub(crate) fn alloc(&mut self, id: EntityId) -> Handle {
        self.alive += 1;
        if let Some(slot) = self.free.pop() {
            let meta = &mut self.metas[slot as usize];
            assert!(meta.id.is_none(), "free list held a live slot");
            meta.id = Some(id);
            return Handle {
                slot,
                generation: meta.generation,
            };
        }
        let slot = u32::try_from(self.metas.len()).expect("slot space exhausted on this floor");
        self.metas.push(Meta {
            generation: 0,
            id: Some(id),
        });
        Handle {
            slot,
            generation: 0,
        }
    }

    pub(crate) fn free(&mut self, h: Handle) -> EntityId {
        let id = self.id(h).expect("despawn of a dead handle");
        let meta = &mut self.metas[h.slot as usize];
        meta.id = None;
        self.alive -= 1;
        // A wrapped generation would revive every stale handle to this slot.
        if meta.generation != u32::MAX {
            meta.generation += 1;
            self.free.push(h.slot);
        }
        id
    }

    #[inline]
    pub(crate) fn is_alive(&self, h: Handle) -> bool {
        self.id(h).is_some()
    }

    #[inline]
    pub(crate) fn id(&self, h: Handle) -> Option<EntityId> {
        self.metas
            .get(h.slot as usize)
            .filter(|meta| meta.generation == h.generation)
            .and_then(|meta| meta.id)
    }

    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.alive
    }
}

#[cfg(test)]
mod tests {
    use super::Entities;
    use crate::id::{EntityId, FloorId};

    #[test]
    fn slot_retires_at_max_generation() {
        let mut entities = Entities::default();
        let first = entities.alloc(EntityId::new(FloorId(0), 0));
        entities.free(first);
        entities.metas[0].generation = u32::MAX - 1;

        let before_last = entities.alloc(EntityId::new(FloorId(0), 1));
        entities.free(before_last);
        let last = entities.alloc(EntityId::new(FloorId(0), 2));
        assert_eq!((last.slot, last.generation), (0, u32::MAX));
        entities.free(last);

        let next = entities.alloc(EntityId::new(FloorId(0), 3));
        assert_eq!(next.slot, 1);
        assert!(!entities.is_alive(last));
    }
}
