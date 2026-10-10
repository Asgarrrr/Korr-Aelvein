use korr_grid::Pos;
use korr_random::{ModuleKey, name_hash};

use crate::time::Cost;

/// A const hash of `module/name`: the stable identity of an action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ActionKey(pub(crate) u64);

impl ActionKey {
    #[must_use]
    pub const fn to_bits(self) -> u64 {
        self.0
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct ActionDesc {
    pub(crate) module: ModuleKey,
    key: ActionKey,
    name: &'static str,
}

impl ActionDesc {
    #[must_use]
    pub const fn new(module: &'static str, name: &'static str) -> Self {
        Self {
            module: ModuleKey::of(module),
            key: ActionKey(name_hash(&[module, name])),
            name,
        }
    }

    #[must_use]
    pub const fn key(&self) -> ActionKey {
        self.key
    }

    #[must_use]
    pub fn same_module(&self, other: &ActionDesc) -> bool {
        self.module == other.module
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Target {
    None,
    Pos(Pos),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prepared {
    Go {
        cost: Cost,
    },
    Instead {
        action: &'static ActionDesc,
        target: Target,
    },
    Blocked,
    Fail,
}
