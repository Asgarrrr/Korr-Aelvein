//! The registry: which mechanics run, in which order.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

use alloc::vec::Vec;

use korr_core::{ActionDesc, Candidates, CommitCtx, Mechanics, PrepCtx, Prepared, Senses, Target};
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
    fn actions(&self, out: &mut Vec<&'static ActionDesc>) {
        if self.wander.is_some() {
            out.push(&korr_wander::ROAM);
        }
    }

    fn perceives(&self) -> bool {
        false
    }

    fn propose(&self, senses: &Senses<'_>, out: &mut Candidates) {
        if let Some(wander) = &self.wander {
            wander.propose(senses, out);
        }
    }

    fn prepare(&self, action: &'static ActionDesc, target: Target, ctx: &PrepCtx<'_>) -> Prepared {
        self.wander(action).prepare(target, ctx)
    }

    fn commit(&self, action: &'static ActionDesc, target: Target, ctx: &mut CommitCtx<'_>) {
        self.wander(action).commit(target, ctx);
    }
}
