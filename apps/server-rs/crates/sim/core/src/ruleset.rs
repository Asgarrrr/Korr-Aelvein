use alloc::vec::Vec;

use korr_ecs::{Own, Schema, SchemaBuilder, checksum};
use korr_random::ModuleKey;

use crate::decision::Intent;
use crate::module::{Action, ActionKey, Mechanics, Module, Visit, module_key};
use crate::time::Tick;

/// One module of the mechanics: its actions' keys in `ALL` order.
#[derive(Debug)]
pub(crate) struct ModuleEntry {
    pub(crate) key: ModuleKey,
    pub(crate) name: &'static str,
    pub(crate) actions: Vec<ActionKey>,
}

/// What every floor of a world shares: the schema, the module table and the core's keys.
#[derive(Debug)]
pub struct Ruleset {
    pub(crate) schema: Schema,
    pub(crate) intent: Own<Intent>,
    /// When the actor acts next: the schedule is rebuilt from it on load.
    pub(crate) clock: Own<Tick>,
    /// In visit order: a candidate's module ordinal indexes it.
    pub(crate) modules: Vec<ModuleEntry>,
    /// Whether any module reads `Senses::seen`.
    pub(crate) perceives: bool,
    fingerprint: u64,
}

#[derive(Default)]
struct Table {
    modules: Vec<ModuleEntry>,
    perceives: bool,
    /// Every action key with its module ordinal and name, to report a collision.
    keys: Vec<(ActionKey, usize, &'static str)>,
}

impl Visit for Table {
    fn module<M: Module>(&mut self, module: &M) {
        let key = module_key::<M>();
        assert!(
            self.modules.iter().all(|m| m.key != key),
            "module registered twice: {}",
            M::NAME
        );
        let ordinal = self.modules.len();
        let actions = M::Action::ALL
            .iter()
            .map(|&action| {
                let key = ActionKey::of::<M>(action);
                self.keys.push((key, ordinal, action.name()));
                key
            })
            .collect();
        self.perceives |= module.perceives();
        self.modules.push(ModuleEntry {
            key,
            name: M::NAME,
            actions,
        });
    }
}

impl Ruleset {
    /// # Panics
    /// When two modules share a name or two actions share an `ActionKey`.
    #[must_use]
    pub(crate) fn new(mut schema: SchemaBuilder, mechanics: &impl Mechanics) -> Self {
        let intent = schema.register::<Intent>("core.intent");
        let clock = schema.register::<Tick>("core.clock");
        let schema = schema.build();
        let mut table = Table::default();
        mechanics.each(&mut table);
        let mut bytes = Vec::from(schema.fingerprint().to_le_bytes());
        for action in table.modules.iter().flat_map(|m| &m.actions) {
            bytes.extend_from_slice(&action.to_bits().to_le_bytes());
        }
        let fingerprint = checksum(&bytes);
        table.keys.sort_unstable_by_key(|&(key, ..)| key);
        for pair in table.keys.windows(2) {
            if let [(key, a_module, a), (other, b_module, b)] = pair {
                assert!(
                    key != other,
                    "action key collision: {key:?} for {}.{a} and {}.{b}",
                    table.modules[*a_module].name,
                    table.modules[*b_module].name
                );
            }
        }
        Self {
            schema,
            intent,
            clock,
            modules: table.modules,
            perceives: table.perceives,
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
