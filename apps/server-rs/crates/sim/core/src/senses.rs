use korr_ecs::EntityId;
use korr_grid::Pos;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seen {
    pub id: EntityId,
    pub pos: Pos,
}

/// What an actor perceives this turn: one snapshot, so every proposer reads
/// the same facts whatever the registry order.
#[derive(Debug)]
pub struct Senses<'a> {
    pos: Pos,
    seen: &'a [Seen],
}

impl<'a> Senses<'a> {
    pub(crate) fn new(pos: Pos, seen: &'a [Seen]) -> Self {
        Self { pos, seen }
    }

    #[must_use]
    pub fn pos(&self) -> Pos {
        self.pos
    }

    /// The other actors within sight, in neighbourhood order; empty when the
    /// mechanics do not perceive.
    #[must_use]
    pub fn seen(&self) -> &'a [Seen] {
        self.seen
    }
}
