use std::fmt;

use hecs::{Entity, World};

use crate::{Backend, Hunger, Pos, Vel, digest, seed_row};

pub struct HecsWorld {
    worlds: [World; 2],
    index: Vec<(u8, Entity)>,
}

impl fmt::Debug for HecsWorld {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HecsWorld")
            .field("entities", &self.index.len())
            .finish_non_exhaustive()
    }
}

impl HecsWorld {
    fn spawn(&mut self, floor: u8, row: (Pos, Hunger, Option<Vel>)) -> Entity {
        let world = &mut self.worlds[usize::from(floor)];
        match row.2 {
            Some(vel) => world.spawn((row.0, row.1, vel)),
            None => world.spawn((row.0, row.1)),
        }
    }
}

impl Backend for HecsWorld {
    const NAME: &'static str = "hecs";

    fn populate(n: u32) -> Self {
        let mut hecs = Self {
            worlds: [World::new(), World::new()],
            index: Vec::with_capacity(n as usize),
        };
        for i in 0..n {
            let e = hecs.spawn(0, seed_row(i));
            hecs.index.push((0, e));
        }
        hecs
    }

    fn churn(&mut self, picks: &[u32]) {
        for &p in picks {
            let (floor, e) = self.index[p as usize];
            let world = &mut self.worlds[usize::from(floor)];
            let pos = *world.get::<&Pos>(e).expect("alive entity has a position");
            let hunger = *world.get::<&Hunger>(e).expect("alive entity has a hunger");
            let vel = world.get::<&Vel>(e).ok().map(|v| *v);
            world.despawn(e).expect("entity is alive");
            self.index[p as usize].1 =
                self.spawn(floor, (pos, Hunger(hunger.0.saturating_add(1)), vel));
        }
    }

    fn actor_turn(&mut self, picks: &[u32]) -> u64 {
        let mut sum = 0_u64;
        for &p in picks {
            let (floor, e) = self.index[p as usize];
            let (pos, hunger) = self.worlds[usize::from(floor)]
                .query_one_mut::<(&Pos, &mut Hunger)>(e)
                .expect("alive entity has a position and a hunger");
            sum = sum
                .wrapping_add(u64::from(pos.x.cast_unsigned()))
                .wrapping_add(u64::from(hunger.0));
            hunger.0 = hunger.0.saturating_sub(1);
        }
        sum
    }

    fn bulk(&mut self) {
        for world in &mut self.worlds {
            for hunger in world.query_mut::<&mut Hunger>() {
                hunger.0 = hunger.0.saturating_sub(1);
            }
        }
    }

    fn query(&mut self) {
        for world in &mut self.worlds {
            for (pos, vel) in world.query_mut::<(&mut Pos, &Vel)>() {
                pos.x = pos.x.wrapping_add(vel.dx);
                pos.y = pos.y.wrapping_add(vel.dy);
            }
        }
    }

    fn travel(&mut self, picks: &[u32]) {
        for &p in picks {
            let (from, e) = self.index[p as usize];
            let to = 1 - from;
            let [source, target] = self
                .worlds
                .get_disjoint_mut([usize::from(from), usize::from(to)])
                .expect("two distinct floors");
            let taken = source.take(e).expect("entity is alive");
            self.index[p as usize] = (to, target.spawn(taken));
        }
    }

    fn checksum(&self) -> u64 {
        (0..).zip(&self.index).fold(0_u64, |sum, (i, &(floor, e))| {
            let world = &self.worlds[usize::from(floor)];
            let pos = *world.get::<&Pos>(e).expect("alive entity has a position");
            let hunger = *world.get::<&Hunger>(e).expect("alive entity has a hunger");
            let vel = world.get::<&Vel>(e).ok().map(|v| *v);
            sum.wrapping_add(digest(i, floor, pos, hunger, vel))
        })
    }
}
