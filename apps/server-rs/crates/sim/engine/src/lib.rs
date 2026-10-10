//! The registry: which mechanics run, in which order.
#![no_std]
#![deny(clippy::float_arithmetic)]

use korr_core::{ActionDesc, Candidates, CommitCtx, Mechanics, PrepCtx, Prepared};
use korr_wander::Wander;

/// One field per mechanic, in run order. `None` disables it.
#[derive(Debug)]
pub struct Registry {
    pub wander: Option<Wander>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            wander: Some(Wander),
        }
    }
}

impl Registry {
    fn wander(&self, action: &ActionDesc) -> &Wander {
        match &self.wander {
            Some(wander) if action.same_module(&korr_wander::ROAM) => wander,
            _ => panic!("action of no module in this registry: {action:?}"),
        }
    }
}

impl Mechanics for Registry {
    fn propose(&self, out: &mut Candidates) {
        if let Some(wander) = &self.wander {
            wander.propose(out);
        }
    }

    fn prepare(&self, action: &'static ActionDesc, ctx: &PrepCtx<'_>) -> Prepared {
        self.wander(action).prepare(ctx)
    }

    fn commit(&self, action: &'static ActionDesc, ctx: &mut CommitCtx<'_>) {
        self.wander(action).commit(ctx);
    }
}
