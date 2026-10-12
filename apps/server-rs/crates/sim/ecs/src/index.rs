//! Open addressing with linear probing. Removal shifts the cluster back
//! (Knuth, TAOCP vol. 3, 6.4 Algorithm R): churn leaves no tombstones.

use alloc::vec;
use alloc::vec::Vec;
use core::mem;

use crate::id::EntityId;

const MIN_CAPACITY: usize = 16;
/// 2^64 over the golden ratio: Fibonacci hashing spreads consecutive counters.
const MIX: u64 = 0x9E37_79B9_7F4A_7C15;

/// Live ids to their slots, at most half full so a probe always ends.
pub(crate) struct IdIndex {
    buckets: Vec<Option<(EntityId, u32)>>,
    len: usize,
    shift: u32,
}

impl IdIndex {
    pub(crate) const fn new() -> Self {
        Self {
            buckets: Vec::new(),
            len: 0,
            shift: 0,
        }
    }

    #[inline]
    pub(crate) fn get(&self, id: EntityId) -> Option<u32> {
        self.find(id)
            .and_then(|at| self.buckets[at])
            .map(|(_, slot)| slot)
    }

    /// # Panics
    /// When `id` is already indexed.
    pub(crate) fn insert(&mut self, id: EntityId, slot: u32) {
        if 2 * (self.len + 1) > self.buckets.len() {
            self.grow();
        }
        self.place(id, slot);
        self.len += 1;
    }

    /// # Panics
    /// When `id` is not indexed.
    pub(crate) fn remove(&mut self, id: EntityId) {
        let mut hole = self.find(id).expect("removal of an unindexed id");
        self.len -= 1;
        let mask = self.buckets.len() - 1;
        let mut at = hole;
        loop {
            at = (at + 1) & mask;
            let Some((held, _)) = self.buckets[at] else {
                break;
            };
            // It moves back when the hole lies between its home and it.
            if at.wrapping_sub(self.home(held)) & mask >= at.wrapping_sub(hole) & mask {
                self.buckets[hole] = self.buckets[at];
                hole = at;
            }
        }
        self.buckets[hole] = None;
    }

    #[inline]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the shift keeps fewer bits than the capacity's"
    )]
    fn home(&self, id: EntityId) -> usize {
        (id.to_bits().wrapping_mul(MIX) >> self.shift) as usize
    }

    #[inline]
    fn find(&self, id: EntityId) -> Option<usize> {
        if self.len == 0 {
            return None;
        }
        let mask = self.buckets.len() - 1;
        let mut at = self.home(id);
        while let Some((held, _)) = self.buckets[at] {
            if held == id {
                return Some(at);
            }
            at = (at + 1) & mask;
        }
        None
    }

    fn place(&mut self, id: EntityId, slot: u32) {
        let mask = self.buckets.len() - 1;
        let mut at = self.home(id);
        while let Some((held, _)) = self.buckets[at] {
            assert!(held != id, "id indexed twice");
            at = (at + 1) & mask;
        }
        self.buckets[at] = Some((id, slot));
    }

    fn grow(&mut self) {
        let capacity = (self.buckets.len() * 2).max(MIN_CAPACITY);
        let old = mem::replace(&mut self.buckets, vec![None; capacity]);
        self.shift = u64::BITS - capacity.trailing_zeros();
        for (id, slot) in old.into_iter().flatten() {
            self.place(id, slot);
        }
    }
}

#[cfg(test)]
mod tests {
    use alloc::collections::BTreeMap;
    use core::num::NonZeroU32;

    use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

    use super::IdIndex;
    use crate::id::{EntityId, FloorId};

    /// Ids from a narrow range on two floors collide often and form long clusters.
    #[test]
    fn churn_matches_a_map() {
        let stream = Stream::new(Seed(1), ModuleKey::of("id-index"), Phase::Action, 0);
        let draw = |step: u64, n: u32, bound: u32| {
            let bound = NonZeroU32::new(bound).expect("bound is not zero");
            stream.below(Subject::Entity(step), DrawIndex(n), bound)
        };
        let mut index = IdIndex::new();
        let mut model = BTreeMap::new();
        for step in 0..20_000 {
            let floor = FloorId(u16::try_from(draw(step, 0, 2)).expect("below 2"));
            let id = EntityId::new(floor, u64::from(draw(step, 1, 300)));
            let slot = draw(step, 2, 1_000);
            if model.remove(&id).is_some() {
                index.remove(id);
            } else {
                index.insert(id, slot);
                model.insert(id, slot);
            }
            assert_eq!(index.len, model.len());
            for (&id, &slot) in &model {
                assert_eq!(index.get(id), Some(slot), "step {step}: {id:?}");
            }
            assert_eq!(index.get(EntityId::new(FloorId(2), 0)), None);
        }
    }

    #[test]
    #[should_panic(expected = "id indexed twice")]
    fn a_duplicate_insert_panics() {
        let mut index = IdIndex::new();
        let id = EntityId::new(FloorId(0), 7);
        index.insert(id, 0);
        index.insert(id, 1);
    }

    #[test]
    #[should_panic(expected = "removal of an unindexed id")]
    fn removing_an_absent_id_panics() {
        let mut index = IdIndex::new();
        index.insert(EntityId::new(FloorId(0), 7), 0);
        index.remove(EntityId::new(FloorId(0), 8));
    }
}
