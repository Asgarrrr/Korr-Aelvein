use crate::action::{ActionDesc, Prepared};
use crate::ctx::{CommitCtx, PrepCtx};
use crate::decision::Candidates;

/// The mechanics a world runs. `prepare` reads; `commit` writes and cannot fail.
pub trait Mechanics {
    fn propose(&self, out: &mut Candidates);
    fn prepare(&self, action: &'static ActionDesc, ctx: &PrepCtx<'_>) -> Prepared;
    fn commit(&self, action: &'static ActionDesc, ctx: &mut CommitCtx<'_>);
}
