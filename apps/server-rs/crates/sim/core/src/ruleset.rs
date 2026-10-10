use alloc::vec::Vec;

use korr_ecs::{Own, Schema, SchemaBuilder, checksum};

use crate::decision::Intent;
use crate::mechanics::Mechanics;
use crate::time::Tick;

/// What every floor of a world shares: the schema and the core's keys.
#[derive(Debug)]
pub struct Ruleset {
    pub(crate) schema: Schema,
    pub(crate) intent: Own<Intent>,
    /// When the actor acts next: the schedule is rebuilt from it on load.
    pub(crate) clock: Own<Tick>,
    fingerprint: u64,
}

impl Ruleset {
    /// # Panics
    /// When two actions share an `ActionKey`.
    #[must_use]
    pub(crate) fn new(mut schema: SchemaBuilder, mechanics: &impl Mechanics) -> Self {
        let intent = schema.register::<Intent>("core.intent");
        let clock = schema.register::<Tick>("core.clock");
        let schema = schema.build();
        let mut actions = Vec::new();
        mechanics.actions(&mut actions);
        let mut bytes = Vec::from(schema.fingerprint().to_le_bytes());
        for action in &actions {
            bytes.extend_from_slice(&action.key().to_bits().to_le_bytes());
        }
        let fingerprint = checksum(&bytes);
        actions.sort_unstable_by_key(|action| action.key());
        for pair in actions.windows(2) {
            if let [a, b] = pair {
                assert!(
                    a.key() != b.key(),
                    "action key collision: {:?} for {a:?} and {b:?}",
                    a.key()
                );
            }
        }
        Self {
            schema,
            intent,
            clock,
            fingerprint,
        }
    }

    /// The schema's fingerprint and the action keys: a save loads only under
    /// a ruleset with the same fingerprint.
    #[must_use]
    pub fn fingerprint(&self) -> u64 {
        self.fingerprint
    }
}
