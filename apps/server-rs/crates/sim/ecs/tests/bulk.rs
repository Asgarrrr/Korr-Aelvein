use std::collections::BTreeMap;
use std::num::NonZeroU32;

use korr_ecs::{Component, FloorId, Handle, ImageError, Reader, SchemaBuilder, Store, Writer};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

struct Hunger(u16);

impl Component for Hunger {
    fn write(&self, w: &mut Writer) {
        w.write_u16(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u16().map(Self)
    }
}

#[test]
fn decay_kills_each_entity_on_its_turn() {
    let mut builder = SchemaBuilder::default();
    let hunger = builder.register::<Hunger>("hunger");
    let mut store = Store::new(&builder.build(), FloorId(0));
    let stream = Stream::new(Seed(1), ModuleKey::of("ecs-bulk"), Phase::Spawn, 0);
    let range = NonZeroU32::new(100).expect("not zero");
    let mut initial = BTreeMap::new();
    for _ in 0..10_000 {
        let h = store.spawn();
        let id = store.id(h).expect("a spawned handle is alive");
        let drawn = stream.below(Subject::Entity(id.to_bits()), DrawIndex(0), range) + 1;
        let start = u16::try_from(drawn).expect("at most 100");
        store.insert(hunger, h, Hunger(start));
        initial.insert(id, start);
    }

    for turn in 1..=100 {
        for h in store.values_mut(hunger) {
            h.0 = h.0.saturating_sub(1);
        }
        let starved: Vec<Handle> = store
            .iter(hunger)
            .filter(|(_, value)| value.0 == 0)
            .map(|(h, _)| h)
            .collect();
        for h in starved {
            store.despawn(h);
        }

        let survivors = initial.values().filter(|&&start| start > turn).count();
        assert_eq!(store.len(), survivors, "turn {turn}");
        for (h, value) in store.iter(hunger) {
            let id = store.id(h).expect("iter yields live handles");
            assert_eq!(value.0, initial[&id] - turn, "turn {turn}: {id:?}");
        }
    }
}
