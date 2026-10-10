//! Joins walk the first key's dense order, so the order is predictable from
//! one column: put the rarer component first.

use crate::codec::Component;
use crate::column::{FOREIGN_KEY, typed_mut};
use crate::id::Handle;
use crate::schema::ComponentKey;
use crate::store::Store;

const SELF_JOIN: &str = "join of a component with itself";

impl Store {
    /// Every holder of both `a` and `b`, in the dense order of `a`.
    ///
    /// # Panics
    /// When `a` and `b` are the same key, or a key comes from another schema.
    pub fn join<A: Component, B: Component>(
        &self,
        a: ComponentKey<A>,
        b: ComponentKey<B>,
    ) -> impl Iterator<Item = (Handle, &A, &B)> + '_ {
        assert!(a.id != b.id, "{SELF_JOIN}");
        let (a, b) = (self.column(a), self.column(b));
        a.owners()
            .iter()
            .zip(a.values())
            .filter_map(|(&slot, a)| Some((self.entities.handle_at(slot), a, b.get(slot)?)))
    }

    /// Calls `f` on every holder of both `a` and `b`, in the dense order of
    /// `a`. `f` cannot reach the store, so a join never changes structure.
    ///
    /// # Panics
    /// When `a` and `b` are the same key, or a key comes from another schema.
    pub fn join_mut<A: Component, B: Component>(
        &mut self,
        a: ComponentKey<A>,
        b: ComponentKey<B>,
        mut f: impl FnMut(Handle, &mut A, &mut B),
    ) {
        assert!(a.id != b.id, "{SELF_JOIN}");
        let [a, b] = self
            .columns
            .get_disjoint_mut([a.id.0 as usize, b.id.0 as usize])
            .expect(FOREIGN_KEY);
        let a = typed_mut::<A>(&mut **a);
        let b = typed_mut::<B>(&mut **b);
        for index in 0..a.owners().len() {
            let slot = a.owners()[index];
            if let Some(b) = b.get_mut(slot) {
                f(self.entities.handle_at(slot), &mut a.values_mut()[index], b);
            }
        }
    }
}
