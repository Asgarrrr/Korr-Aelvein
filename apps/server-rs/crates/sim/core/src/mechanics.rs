use alloc::vec::Vec;

use crate::action::{ActionDesc, Prepared, Target};
use crate::ctx::{CommitCtx, PrepCtx};
use crate::decision::Candidates;
use crate::senses::Senses;

/// The mechanics a world runs. `prepare` reads; `commit` writes and cannot fail.
pub trait Mechanics {
    fn actions(&self, out: &mut Vec<&'static ActionDesc>);
    /// Whether any `propose` reads `Senses::seen`; when none does, the core skips the scan.
    fn perceives(&self) -> bool;
    fn propose(&self, senses: &Senses<'_>, out: &mut Candidates);
    fn prepare(&self, action: &'static ActionDesc, target: Target, ctx: &PrepCtx<'_>) -> Prepared;
    fn commit(&self, action: &'static ActionDesc, target: Target, ctx: &mut CommitCtx<'_>);
}
