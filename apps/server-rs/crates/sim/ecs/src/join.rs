//! A join walks the first key's dense order, so the order is predictable from
//! one column: put the rarer component first.

use alloc::vec::Vec;

use crate::codec::Component;
use crate::column::{FOREIGN_KEY, typed_mut};
use crate::id::Handle;
use crate::schema::Own;
use crate::store::Store;

impl Store {
    /// Calls `f` on every holder of both `a` and `b`, in the dense order of
    /// `a`, and pushes each `Some` it returns to `out` with its holder. `f`
    /// cannot reach the store, so a join never changes structure.
    ///
    /// # Panics
    /// When `a` and `b` are the same key, or a key comes from another schema.
    pub fn join_mut<A: Component, B: Component, R>(
        &mut self,
        a: &Own<A>,
        b: &Own<B>,
        out: &mut Vec<(Handle, R)>,
        mut f: impl FnMut(&mut A, &mut B) -> Option<R>,
    ) {
        assert!(
            a.read().id != b.read().id,
            "join of a component with itself"
        );
        let indices = [self.index(a.read()), self.index(b.read())];
        let [a, b] = self.columns.get_disjoint_mut(indices).expect(FOREIGN_KEY);
        let a = typed_mut::<A>(&mut **a);
        let b = typed_mut::<B>(&mut **b);
        for (slot, a) in a.rows_mut() {
            if let Some(b) = b.get_mut(slot)
                && let Some(r) = f(a, b)
            {
                out.push((self.entities.handle_at(slot), r));
            }
        }
    }
}
