use korr_random::ModuleKey;

use crate::time::Cost;

#[derive(Debug)]
pub struct ActionDesc {
    pub(crate) module: ModuleKey,
    #[expect(
        dead_code,
        reason = "read through Debug only, to name the action in panics"
    )]
    name: &'static str,
}

impl ActionDesc {
    #[must_use]
    pub const fn new(module: &'static str, name: &'static str) -> Self {
        Self {
            module: ModuleKey::of(module),
            name,
        }
    }

    #[must_use]
    pub fn same_module(&self, other: &ActionDesc) -> bool {
        self.module == other.module
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prepared {
    Go { cost: Cost },
    Blocked,
}
