use alloc::vec::Vec;
use core::cmp::Reverse;

use korr_ecs::{Component, ImageError, Reader, Writer};
use korr_grid::Pos;

use crate::config::INERTIA;
use crate::module::{ActionKey, Target};

/// Declaration order is the rank: a higher band beats any weight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Band {
    Routine,
    Vigilance,
}

/// Built only by `Proposals::push`: the module ordinal and `ALL` index route the run.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ActionRef {
    pub(crate) module: u16,
    pub(crate) index: u16,
    pub(crate) key: ActionKey,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Candidate {
    pub(crate) action: ActionRef,
    pub(crate) band: Band,
    pub(crate) weight: u16,
    pub(crate) target: Target,
}

/// The action and target an actor last ran.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Intent {
    pub action: ActionKey,
    pub target: Target,
}

const TARGET_NONE: u8 = 0;
const TARGET_POS: u8 = 1;

impl Component for Intent {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u64(self.action.to_bits());
        match self.target {
            Target::None => w.write_u8(TARGET_NONE),
            Target::Pos(p) => {
                w.write_u8(TARGET_POS);
                w.write_i16(p.x);
                w.write_i16(p.y);
            }
        }
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        let action = ActionKey(r.read_u64()?);
        let target = match r.read_u8()? {
            TARGET_NONE => Target::None,
            TARGET_POS => Target::Pos(Pos {
                x: r.read_i16()?,
                y: r.read_i16()?,
            }),
            _ => return Err(ImageError::Corrupt("target")),
        };
        Ok(Self { action, target })
    }
}

#[derive(Debug, Default)]
pub(crate) struct Candidates(Vec<Candidate>);

impl Candidates {
    pub(crate) fn push(&mut self, c: Candidate) {
        self.0.push(c);
    }

    pub(crate) fn clear(&mut self) {
        self.0.clear();
    }

    /// The maximum, never a sum: neither push order nor registry order decides.
    pub(crate) fn pick(
        &self,
        intent: Option<Intent>,
        excluded: Option<ActionKey>,
    ) -> Option<Candidate> {
        self.0
            .iter()
            .copied()
            .filter(|c| Some(c.action.key) != excluded)
            .max_by_key(|c| {
                let current = Intent {
                    action: c.action.key,
                    target: c.target,
                };
                let bonus = if intent == Some(current) { INERTIA } else { 0 };
                (
                    c.band,
                    c.weight.saturating_add(bonus),
                    Reverse(current.action),
                    Reverse(c.target),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use korr_ecs::{Component, ImageError, Reader, Writer};

    use super::{ActionRef, Band, Candidate, Candidates, INERTIA, Intent, TARGET_POS};
    use crate::module::{ActionKey, Target};

    fn candidate(key: u64, weight: u16) -> Candidate {
        Candidate {
            action: ActionRef {
                module: 0,
                index: 0,
                key: ActionKey(key),
            },
            band: Band::Routine,
            weight,
            target: Target::None,
        }
    }

    /// The current intent holds the lower key, so a tie after the bonus keeps it.
    fn keeps_intent_against(rival: u16) -> bool {
        let mut candidates = Candidates::default();
        candidates.push(candidate(1, 10));
        candidates.push(candidate(2, 10 + rival));
        let intent = Intent {
            action: ActionKey(1),
            target: Target::None,
        };
        candidates
            .pick(Some(intent), None)
            .is_some_and(|c| c.action.key == ActionKey(1))
    }

    #[test]
    fn inertia_outweighs_a_rival_up_to_its_bonus_and_no_further() {
        assert!(keeps_intent_against(INERTIA));
        assert!(!keeps_intent_against(INERTIA + 1));
    }

    #[test]
    fn an_unknown_target_tag_is_corrupt() {
        let mut w = Writer::new();
        w.write_u64(0);
        w.write_u8(TARGET_POS + 1);
        let bytes = w.into_bytes();
        assert_eq!(
            Intent::read(&mut Reader::new(&bytes)).err(),
            Some(ImageError::Corrupt("target"))
        );
    }
}
