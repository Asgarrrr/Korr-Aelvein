use bevy_ecs::entity::Entity;
use bevy_ecs::query::QueryState;
use bevy_ecs::world::World;

use crate::{Backend, Hunger, Pos, Vel, digest, seed_row};

#[derive(Debug)]
struct Floor {
    world: World,
    hungers: QueryState<&'static mut Hunger>,
    movers: QueryState<(&'static mut Pos, &'static Vel)>,
}

impl Floor {
    fn new() -> Self {
        let mut world = World::new();
        let hungers = world.query();
        let movers = world.query();
        Self {
            world,
            hungers,
            movers,
        }
    }

    fn spawn(&mut self, (pos, hunger, vel): (Pos, Hunger, Option<Vel>)) -> Entity {
        match vel {
            Some(vel) => self.world.spawn((pos, hunger, vel)).id(),
            None => self.world.spawn((pos, hunger)).id(),
        }
    }

    fn row(&self, e: Entity) -> (Pos, Hunger, Option<Vel>) {
        (
            *self
                .world
                .get::<Pos>(e)
                .expect("alive entity has a position"),
            *self
                .world
                .get::<Hunger>(e)
                .expect("alive entity has a hunger"),
            self.world.get::<Vel>(e).copied(),
        )
    }
}

#[derive(Debug)]
pub struct BevyWorld {
    floors: [Floor; 2],
    index: Vec<(u8, Entity)>,
}

impl Backend for BevyWorld {
    const NAME: &'static str = "bevy";

    fn populate(n: u32) -> Self {
        let mut floor = Floor::new();
        let index = (0..n).map(|i| (0, floor.spawn(seed_row(i)))).collect();
        Self {
            floors: [floor, Floor::new()],
            index,
        }
    }

    fn churn(&mut self, picks: &[u32]) {
        for &p in picks {
            let (floor, e) = self.index[p as usize];
            let floor = &mut self.floors[usize::from(floor)];
            let (pos, hunger, vel) = floor.row(e);
            assert!(floor.world.despawn(e), "entity is alive");
            self.index[p as usize].1 = floor.spawn((pos, Hunger(hunger.0.saturating_add(1)), vel));
        }
    }

    fn actor_turn(&mut self, picks: &[u32]) -> u64 {
        let mut sum = 0_u64;
        for &p in picks {
            let (floor, e) = self.index[p as usize];
            let world = &mut self.floors[usize::from(floor)].world;
            let x = world.get::<Pos>(e).expect("alive entity has a position").x;
            let mut hunger = world
                .get_mut::<Hunger>(e)
                .expect("alive entity has a hunger");
            sum = sum
                .wrapping_add(u64::from(x.cast_unsigned()))
                .wrapping_add(u64::from(hunger.0));
            hunger.0 = hunger.0.saturating_sub(1);
        }
        sum
    }

    fn bulk(&mut self) {
        for floor in &mut self.floors {
            for mut hunger in floor.hungers.iter_mut(&mut floor.world) {
                hunger.0 = hunger.0.saturating_sub(1);
            }
        }
    }

    fn query(&mut self) {
        for floor in &mut self.floors {
            for (mut pos, vel) in floor.movers.iter_mut(&mut floor.world) {
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
                .floors
                .get_disjoint_mut([usize::from(from), usize::from(to)])
                .expect("two distinct floors");
            let row = source.row(e);
            assert!(source.world.despawn(e), "entity is alive");
            self.index[p as usize] = (to, target.spawn(row));
        }
    }

    fn checksum(&self) -> u64 {
        (0..).zip(&self.index).fold(0_u64, |sum, (i, &(floor, e))| {
            let (pos, hunger, vel) = self.floors[usize::from(floor)].row(e);
            sum.wrapping_add(digest(i, floor, pos, hunger, vel))
        })
    }
}
