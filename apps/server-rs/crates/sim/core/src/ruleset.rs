use alloc::vec::Vec;

use korr_ecs::{AnyRead, Own, Schema, SchemaBuilder, checksum};
use korr_random::ModuleKey;

use crate::decision::Intent;
use crate::module::{Action, ActionKey, Mechanics, Module, Visit, module_key};
use crate::time::Tick;

/// One module of the mechanics: its actions' keys and requirements in `ALL` order.
#[derive(Debug)]
pub(crate) struct ModuleEntry {
    pub(crate) key: ModuleKey,
    pub(crate) name: &'static str,
    pub(crate) actions: Vec<ActionKey>,
    pub(crate) requires: Vec<Vec<AnyRead>>,
    pub(crate) column: bool,
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
    /// The names of the modules that own a cell column, in visit order.
    pub(crate) columns: Vec<&'static str>,
    fingerprint: u64,
}

struct Table<'a> {
    schema: &'a Schema,
    modules: Vec<ModuleEntry>,
    perceives: bool,
    columns: Vec<&'static str>,
    /// Every action key with its module ordinal and name, to report a collision.
    keys: Vec<(ActionKey, usize, &'static str)>,
}

impl Visit for Table<'_> {
    fn module<M: Module>(&mut self, module: &M) {
        let key = module_key::<M>();
        assert!(
            self.modules.iter().all(|m| m.key != key),
            "module registered twice: {}",
            M::NAME
        );
        let ordinal = self.modules.len();
        u16::try_from(ordinal).expect("a module table fits u16");
        u16::try_from(M::Action::ALL.len()).expect("a module's actions fit u16");
        let actions = M::Action::ALL
            .iter()
            .map(|&action| {
                let key = ActionKey::of::<M>(action);
                self.keys.push((key, ordinal, action.name()));
                key
            })
            .collect();
        let requires = M::Action::ALL
            .iter()
            .map(|&action| {
                M::requires(action)
                    .iter()
                    .map(|&name| {
                        self.schema.find(name).unwrap_or_else(|| {
                            panic!(
                                "{}.{} requires {name}, which the schema does not register",
                                M::NAME,
                                action.name()
                            )
                        })
                    })
                    .collect()
            })
            .collect();
        self.perceives |= module.perceives();
        if M::CELL_COLUMN {
            self.columns.push(M::NAME);
        }
        self.modules.push(ModuleEntry {
            key,
            name: M::NAME,
            actions,
            requires,
            column: M::CELL_COLUMN,
        });
    }
}

impl Ruleset {
    /// # Panics
    /// When two modules share a name, two actions share an `ActionKey`, or
    /// an action requires a component the schema does not register, or a
    /// module ordinal or action index exceeds `u16`.
    #[must_use]
    pub(crate) fn new(mut schema: SchemaBuilder, mechanics: &impl Mechanics) -> Self {
        let intent = schema.register::<Intent>("core.intent");
        let clock = schema.register::<Tick>("core.clock");
        let schema = schema.build();
        let mut table = Table {
            schema: &schema,
            modules: Vec::new(),
            perceives: false,
            columns: Vec::new(),
            keys: Vec::new(),
        };
        mechanics.each(&mut table);
        let mut bytes = Vec::from(schema.fingerprint().to_le_bytes());
        for module in &table.modules {
            let name_len = u32::try_from(module.name.len()).expect("a module name fits u32 bytes");
            bytes.extend_from_slice(&name_len.to_le_bytes());
            bytes.extend_from_slice(module.name.as_bytes());
            let actions = u32::try_from(module.actions.len()).expect("a module's actions fit u32");
            bytes.extend_from_slice(&actions.to_le_bytes());
            for action in &module.actions {
                bytes.extend_from_slice(&action.to_bits().to_le_bytes());
            }
            bytes.push(u8::from(module.column));
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
        let Table {
            modules,
            perceives,
            columns,
            ..
        } = table;
        Self {
            schema,
            intent,
            clock,
            modules,
            perceives,
            columns,
            fingerprint,
        }
    }

    /// The schema, then the name, action keys and whether it owns a cell column
    /// of each module in visit order: a save loads only under a ruleset with
    /// the same fingerprint.
    #[must_use]
    pub fn fingerprint(&self) -> u64 {
        self.fingerprint
    }
}
