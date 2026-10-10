//! The registry: which mechanics run, in which order.
#![no_std]
#![deny(clippy::float_arithmetic)]

use korr_core::{Mechanics, Visit};
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

impl Mechanics for Registry {
    fn each<V: Visit>(&self, v: &mut V) {
        if let Some(wander) = &self.wander {
            v.module(wander);
        }
    }
}
