use alloc::string::String;
use alloc::vec::Vec;

use korr_ecs::{AnyRead, Own, Schema, SchemaBuilder, checksum};
use korr_random::ModuleKey;

use crate::build::{Recipe, assemble};
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
    /// The slot of the cell column the module binds.
    pub(crate) column: Option<u16>,
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
    /// The names of the cell columns, in slot order.
    pub(crate) columns: Vec<String>,
    fingerprint: u64,
}

struct Table {
    modules: Vec<ModuleEntry>,
    perceives: bool,
    /// The column each module binds, in visit order.
    owners: Vec<Option<u16>>,
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
            .map(|&action| module.requires(action))
            .collect();
        self.perceives |= module.perceives();
        self.modules.push(ModuleEntry {
            key,
            name: M::NAME,
            actions,
            requires,
            column: self.owners[ordinal],
        });
    }
}

impl Ruleset {
    /// The ruleset of a recipe and the mechanics it builds.
    ///
    /// # Panics
    /// When two modules share a name, two actions share an `ActionKey`, the
    /// recipe breaks a contract rule, or a module ordinal or action index
    /// exceeds `u16`.
    #[must_use]
    pub(crate) fn new<R: Recipe>(recipe: R) -> (Self, R::Mechanics) {
        let mut schema = SchemaBuilder::default();
        let intent = schema.register::<Intent>("core.intent");
        let clock = schema.register::<Tick>("core.clock");
        let (mechanics, columns) = assemble(recipe, &mut schema);
        let schema = schema.build();
        let mut table = Table {
            modules: Vec::new(),
            perceives: false,
            owners: columns.owners,
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
            match module.column {
                None => bytes.push(0),
                Some(slot) => {
                    let name = &columns.names[usize::from(slot)];
                    let name_len = u32::try_from(name.len()).expect("a column name fits u32 bytes");
                    bytes.push(1);
                    bytes.extend_from_slice(&slot.to_le_bytes());
                    bytes.extend_from_slice(&name_len.to_le_bytes());
                    bytes.extend_from_slice(name.as_bytes());
                }
            }
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
            modules, perceives, ..
        } = table;
        let ruleset = Self {
            schema,
            intent,
            clock,
            modules,
            perceives,
            columns: columns.names,
            fingerprint,
        };
        (ruleset, mechanics)
    }

    /// The schema, then the name, action keys and bound cell column of each
    /// module in visit order: a save loads only under a ruleset with
    /// the same fingerprint.
    #[must_use]
    pub fn fingerprint(&self) -> u64 {
        self.fingerprint
    }
}
