//! Generational slots on a LIFO free list follow thunderdome 0.6.1 and hecs
//! 0.11.2 (MIT OR Apache-2.0). Both wrap the generation; here a slot retires.

use alloc::collections::BTreeSet;
use alloc::vec;
use alloc::vec::Vec;
use core::mem;

use crate::codec::{Reader, Writer};
use crate::error::ImageError;
use crate::id::{EntityId, FloorId, Handle};

const DEAD: u8 = 0;
const ALIVE: u8 = 1;
const FREE_LIST: ImageError = ImageError::Corrupt("free list");

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

    pub(crate) fn is_slot_alive(&self, slot: u32) -> bool {
        self.metas
            .get(slot as usize)
            .is_some_and(|meta| meta.id.is_some())
    }

    #[inline]
    pub(crate) fn handle_at(&self, slot: u32) -> Handle {
        let meta = &self.metas[slot as usize];
        assert!(meta.id.is_some(), "column owner is dead");
        Handle {
            slot,
            generation: meta.generation,
        }
    }

    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.alive
    }

    pub(crate) fn write(&self, w: &mut Writer) {
        w.write_u32(u32::try_from(self.metas.len()).expect("slots fit u32"));
        for meta in &self.metas {
            w.write_u32(meta.generation);
            match meta.id {
                None => w.write_u8(DEAD),
                Some(id) => {
                    w.write_u8(ALIVE);
                    w.write_u64(id.to_bits());
                }
            }
        }
        w.write_u32(u32::try_from(self.free.len()).expect("slots fit u32"));
        for &slot in &self.free {
            w.write_u32(slot);
        }
    }

    /// Keeps the slot table and the free stack as written, so a reloaded
    /// floor hands out the same slots as the saved one would have.
    pub(crate) fn read(
        r: &mut Reader<'_>,
        floor: FloorId,
        next_counter: u64,
    ) -> Result<Self, ImageError> {
        let mut entities = Self::default();
        let mut ids = BTreeSet::new();
        for _ in 0..r.read_u32()? {
            let generation = r.read_u32()?;
            let id = match r.read_u8()? {
                DEAD => None,
                ALIVE => {
                    let id = EntityId::from_bits(r.read_u64()?)
                        .ok_or(ImageError::Corrupt("entity id"))?;
                    if !ids.insert(id) {
                        return Err(ImageError::Corrupt("duplicate entity id"));
                    }
                    if id.origin() == floor && id.counter() >= next_counter {
                        return Err(ImageError::Corrupt("id beyond the floor counter"));
                    }
                    entities.alive += 1;
                    Some(id)
                }
                _ => return Err(ImageError::Corrupt("slot state")),
            };
            entities.metas.push(Meta { generation, id });
        }

        let reusable = |meta: &Meta| meta.id.is_none() && meta.generation != u32::MAX;
        let mut listed = vec![false; entities.metas.len()];
        for _ in 0..r.read_u32()? {
            let slot = r.read_u32()?;
            let index = slot as usize;
            if !entities.metas.get(index).is_some_and(reusable)
                || mem::replace(&mut listed[index], true)
            {
                return Err(FREE_LIST);
            }
            entities.free.push(slot);
        }
        if entities.free.len() != entities.metas.iter().filter(|meta| reusable(meta)).count() {
            return Err(FREE_LIST);
        }
        Ok(entities)
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
