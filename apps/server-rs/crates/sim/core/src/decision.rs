use alloc::vec::Vec;

use crate::action::ActionDesc;

#[derive(Debug, Default)]
pub struct Candidates(Vec<&'static ActionDesc>);

impl Candidates {
    pub fn push(&mut self, action: &'static ActionDesc) {
        self.0.push(action);
    }

    pub(crate) fn clear(&mut self) {
        self.0.clear();
    }

    pub(crate) fn pick(&self) -> Option<&'static ActionDesc> {
        self.0.first().copied()
    }
}
