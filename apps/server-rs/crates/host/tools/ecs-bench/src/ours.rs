use korr_ecs::{ComponentKey, FloorId, Handle, SchemaBuilder, Store};

use crate::{Backend, Hunger, Pos, Vel, digest, seed_row};

#[derive(Debug)]
pub struct Ours {
    stores: [Store; 2],
    pos: ComponentKey<Pos>,
    vel: ComponentKey<Vel>,
    hunger: ComponentKey<Hunger>,
    index: Vec<(u8, Handle)>,
}

impl Ours {
    fn spawn(&mut self, floor: u8, row: (Pos, Hunger, Option<Vel>)) -> Handle {
        let store = &mut self.stores[usize::from(floor)];
        let h = store.spawn();
        store.insert(self.pos, h, row.0);
        store.insert(self.hunger, h, row.1);
        if let Some(vel) = row.2 {
            store.insert(self.vel, h, vel);
        }
        h
    }
}

impl Backend for Ours {
    const NAME: &'static str = "ours";

    fn populate(n: u32) -> Self {
        let mut builder = SchemaBuilder::default();
        let pos = builder.register::<Pos>("pos");
        let vel = builder.register::<Vel>("vel");
        let hunger = builder.register::<Hunger>("hunger");
        let schema = builder.build();
        let mut ours = Self {
            stores: [
                Store::new(&schema, FloorId(0)),
                Store::new(&schema, FloorId(1)),
            ],
            pos,
            vel,
            hunger,
            index: Vec::with_capacity(n as usize),
        };
        for i in 0..n {
            let h = ours.spawn(0, seed_row(i));
            ours.index.push((0, h));
        }
        ours
    }

    fn churn(&mut self, picks: &[u32]) {
        for &p in picks {
            let (floor, h) = self.index[p as usize];
            let store = &mut self.stores[usize::from(floor)];
            let pos = *store.get(self.pos, h).expect("alive entity has a position");
            let hunger = *store
                .get(self.hunger, h)
                .expect("alive entity has a hunger");
            let vel = store.get(self.vel, h).copied();
            store.despawn(h);
            self.index[p as usize].1 =
                self.spawn(floor, (pos, Hunger(hunger.0.saturating_add(1)), vel));
        }
    }

    fn actor_turn(&mut self, picks: &[u32]) -> u64 {
        let mut sum = 0_u64;
        for &p in picks {
            let (floor, h) = self.index[p as usize];
            let store = &mut self.stores[usize::from(floor)];
            let x = store
                .get(self.pos, h)
                .expect("alive entity has a position")
                .x;
            let hunger = store
                .get_mut(self.hunger, h)
                .expect("alive entity has a hunger");
            sum = sum
                .wrapping_add(u64::from(x.cast_unsigned()))
                .wrapping_add(u64::from(hunger.0));
            hunger.0 = hunger.0.saturating_sub(1);
        }
        sum
    }

    fn bulk(&mut self) {
        for store in &mut self.stores {
            for hunger in store.values_mut(self.hunger) {
                hunger.0 = hunger.0.saturating_sub(1);
            }
        }
    }

    fn query(&mut self) {
        for store in &mut self.stores {
            store.join_mut(self.vel, self.pos, |_, vel, pos| {
                pos.x = pos.x.wrapping_add(vel.dx);
                pos.y = pos.y.wrapping_add(vel.dy);
            });
        }
    }

    fn travel(&mut self, picks: &[u32]) {
        for &p in picks {
            let (from, h) = self.index[p as usize];
            let to = 1 - from;
            let [source, target] = self
                .stores
                .get_disjoint_mut([usize::from(from), usize::from(to)])
                .expect("two distinct floors");
            let traveller = source.detach(h);
            let h = target
                .attach(traveller)
                .expect("the row matches the schema");
            self.index[p as usize] = (to, h);
        }
    }

    fn checksum(&self) -> u64 {
        (0..).zip(&self.index).fold(0_u64, |sum, (i, &(floor, h))| {
            let store = &self.stores[usize::from(floor)];
            let pos = *store.get(self.pos, h).expect("alive entity has a position");
            let hunger = *store
                .get(self.hunger, h)
                .expect("alive entity has a hunger");
            let vel = store.get(self.vel, h).copied();
            sum.wrapping_add(digest(i, floor, pos, hunger, vel))
        })
    }
}
