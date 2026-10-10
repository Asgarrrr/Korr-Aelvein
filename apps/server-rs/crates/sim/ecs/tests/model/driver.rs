use std::collections::BTreeMap;
use std::fmt::Debug;
use std::num::NonZeroU32;

use korr_ecs::{
    Component, ComponentKey, EntityId, FloorId, Handle, ImageError, Reader, Schema, SchemaBuilder,
    Store, Traveller, Writer,
};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

const STALE_KEPT: usize = 256;
const OP_SUBJECT: Subject = Subject::Entity(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Pos {
    pub(crate) x: i32,
    pub(crate) y: i32,
}

impl Component for Pos {
    fn write(&self, w: &mut Writer) {
        w.write_i32(self.x);
        w.write_i32(self.y);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self {
            x: r.read_i32()?,
            y: r.read_i32()?,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Hunger(pub(crate) u16);

impl Component for Hunger {
    fn write(&self, w: &mut Writer) {
        w.write_u16(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u16().map(Self)
    }
}

type Row = (Option<Pos>, Option<Hunger>);

#[derive(Debug, Clone, Copy)]
pub(crate) struct Keys {
    pub(crate) pos: ComponentKey<Pos>,
    pub(crate) hunger: ComponentKey<Hunger>,
}

pub(crate) fn schema() -> (Schema, Keys) {
    let mut builder = SchemaBuilder::default();
    let pos = builder.register("pos");
    let hunger = builder.register("hunger");
    (builder.build(), Keys { pos, hunger })
}

/// One `Store` per floor driven by seeded operations next to a `BTreeMap`
/// model of them.
pub(crate) struct World {
    seed: u64,
    step: u64,
    schema: Schema,
    stores: Vec<Store>,
    keys: Keys,
    model: BTreeMap<EntityId, (FloorId, Row)>,
    alive: Vec<(usize, Handle, EntityId)>,
    stale: Vec<(usize, Handle)>,
}

impl World {
    pub(crate) fn new(seed: u64, floors: u16) -> Self {
        let (schema, keys) = schema();
        Self {
            seed,
            step: 0,
            stores: (0..floors)
                .map(|floor| Store::new(&schema, FloorId(floor)))
                .collect(),
            schema,
            keys,
            model: BTreeMap::new(),
            alive: Vec::new(),
            stale: Vec::new(),
        }
    }

    pub(crate) fn run(&mut self, steps: u64) {
        for _ in 0..steps {
            self.step();
        }
    }

    pub(crate) fn images(&self) -> Vec<Vec<u8>> {
        self.stores.iter().map(Store::save).collect()
    }

    /// Replaces each store with a reload of its own image; handles stay valid.
    pub(crate) fn reload(&mut self) {
        for store in &mut self.stores {
            *store = Store::load(&self.schema, &store.save()).expect("own image reloads");
        }
    }

    /// Takes `alive[index]` off its floor. The model keeps its row while it
    /// is in flight, so `check` holds only once it arrives.
    pub(crate) fn depart(&mut self, index: usize) -> Traveller {
        let (floor, h, _) = self.alive.swap_remove(index);
        let traveller = self.stores[floor].detach(h);
        self.retire(floor, h);
        traveller
    }

    pub(crate) fn arrive(&mut self, traveller: Traveller, floor: usize) {
        let id = traveller.id();
        let store = &mut self.stores[floor];
        let h = store.attach(traveller).expect("a detached row attaches");
        self.model.get_mut(&id).expect("travellers are modelled").0 = store.floor();
        self.alive.push((floor, h, id));
    }

    pub(crate) fn step(&mut self) {
        let stream = Stream::new(
            Seed(self.seed),
            ModuleKey::of("ecs-model"),
            Phase::Action,
            self.step,
        );
        self.step += 1;
        let op = stream.below(OP_SUBJECT, DrawIndex(0), bound(100));
        let spawns = if self.stores.len() > 1 { 24 } else { 30 };
        if op < spawns {
            let floor = self.draw_floor(stream);
            let store = &mut self.stores[floor];
            let h = store.spawn();
            let id = store.id(h).expect("a spawned handle is alive");
            self.model.insert(id, (store.floor(), (None, None)));
            self.alive.push((floor, h, id));
            return;
        }
        let Some(len) = NonZeroU32::new(u32::try_from(self.alive.len()).expect("fits u32")) else {
            return;
        };
        let index = stream.below(OP_SUBJECT, DrawIndex(1), len) as usize;
        if op < 30 {
            let to = self.draw_floor(stream);
            let traveller = self.depart(index);
            self.arrive(traveller, to);
        } else if op < 50 {
            self.despawn(index);
        } else {
            self.mutate(stream, op, self.alive[index]);
        }
    }

    fn draw_floor(&self, stream: Stream) -> usize {
        let floors = u32::try_from(self.stores.len()).expect("fits u32");
        stream.below(OP_SUBJECT, DrawIndex(4), bound(floors)) as usize
    }

    fn despawn(&mut self, index: usize) {
        let (floor, h, id) = self.alive.swap_remove(index);
        self.stores[floor].despawn(h);
        self.model.remove(&id);
        self.retire(floor, h);
    }

    fn retire(&mut self, floor: usize, h: Handle) {
        if self.stale.len() == STALE_KEPT {
            self.stale.remove(0);
        }
        self.stale.push((floor, h));
    }

    fn mutate(&mut self, stream: Stream, op: u32, (floor, h, id): (usize, Handle, EntityId)) {
        let step = self.step;
        let store = &mut self.stores[floor];
        let row = &mut self
            .model
            .get_mut(&id)
            .expect("alive entities are modelled")
            .1;
        let (pos, hunger) = (self.keys.pos, self.keys.hunger);
        match op {
            50..65 => {
                let value = Pos {
                    x: i32::from(draw_u16(stream, 2)),
                    y: -i32::from(draw_u16(stream, 3)),
                };
                let previous = row.0.replace(value);
                assert_eq!(store.insert(pos, h, value), previous, "step {step}");
            }
            65..80 => {
                let value = Hunger(draw_u16(stream, 2));
                let previous = row.1.replace(value);
                assert_eq!(store.insert(hunger, h, value), previous, "step {step}");
            }
            80..88 => assert_eq!(store.remove(pos, h), row.0.take(), "step {step}"),
            88..93 => assert_eq!(store.remove(hunger, h), row.1.take(), "step {step}"),
            _ => {
                if let Some(stored) = store.get_mut(pos, h) {
                    stored.x = stored.x.wrapping_add(1);
                }
                if let Some(modelled) = &mut row.0 {
                    modelled.x = modelled.x.wrapping_add(1);
                }
                if let Some(stored) = store.get_mut(hunger, h) {
                    stored.0 = stored.0.wrapping_add(1);
                }
                if let Some(modelled) = &mut row.1 {
                    modelled.0 = modelled.0.wrapping_add(1);
                }
            }
        }
    }

    pub(crate) fn check(&self) {
        let step = self.step;
        let total: usize = self.stores.iter().map(Store::len).sum();
        assert_eq!(total, self.model.len(), "step {step}: total len");
        for store in &self.stores {
            let modelled = self
                .model
                .values()
                .filter(|(floor, _)| *floor == store.floor())
                .count();
            assert_eq!(store.len(), modelled, "step {step}: len of {store:?}");
            self.check_column(store, self.keys.pos, "pos", |row| row.0);
            self.check_column(store, self.keys.hunger, "hunger", |row| row.1);
        }
        for &(floor, h, id) in &self.alive {
            let store = &self.stores[floor];
            let (modelled_floor, (pos, hunger)) = &self.model[&id];
            assert_eq!(
                store.floor(),
                *modelled_floor,
                "step {step}: floor of {id:?}"
            );
            assert_eq!(store.id(h), Some(id), "step {step}: id");
            assert_eq!(
                store.get(self.keys.pos, h),
                pos.as_ref(),
                "step {step}: pos of {id:?}"
            );
            assert_eq!(
                store.get(self.keys.hunger, h),
                hunger.as_ref(),
                "step {step}: hunger of {id:?}"
            );
        }
        for &(floor, h) in &self.stale {
            let store = &self.stores[floor];
            assert!(!store.is_alive(h), "step {step}: stale handle alive");
            assert_eq!(store.get(self.keys.pos, h), None, "step {step}");
            assert_eq!(store.get(self.keys.hunger, h), None, "step {step}");
        }
    }

    fn check_column<T: Component + Copy + Ord + Debug>(
        &self,
        store: &Store,
        key: ComponentKey<T>,
        name: &str,
        project: fn(&Row) -> Option<T>,
    ) {
        let step = self.step;
        let floor = store.floor();
        let on_floor = || {
            self.model
                .iter()
                .filter(move |(_, (at, _))| *at == floor)
                .filter_map(move |(&id, (_, row))| project(row).map(|value| (id, value)))
        };
        let mut values = store.values(key).to_vec();
        values.sort_unstable();
        let mut expected: Vec<T> = on_floor().map(|(_, value)| value).collect();
        expected.sort_unstable();
        assert_eq!(
            values, expected,
            "step {step}: values of {name} on {floor:?}"
        );

        let mut ids: Vec<EntityId> = store
            .iter(key)
            .map(|(h, _)| store.id(h).expect("iter yields live handles"))
            .collect();
        ids.sort_unstable();
        let holders: Vec<EntityId> = on_floor().map(|(id, _)| id).collect();
        assert_eq!(ids, holders, "step {step}: holders of {name} on {floor:?}");
    }
}

fn bound(n: u32) -> NonZeroU32 {
    NonZeroU32::new(n).expect("bound is not zero")
}

fn draw_u16(stream: Stream, n: u32) -> u16 {
    let [low, high, ..] = stream.draw(OP_SUBJECT, DrawIndex(n)).to_le_bytes();
    u16::from_le_bytes([low, high])
}
