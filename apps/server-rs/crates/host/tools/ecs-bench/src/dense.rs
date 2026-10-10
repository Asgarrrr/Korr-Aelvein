use crate::{Backend, Hunger, Pos, Vel, digest, seed_row};

type Row = (Pos, Hunger, Option<Vel>);

#[derive(Debug, Clone, Copy)]
pub struct Slot {
    index: u32,
    generation: u32,
}

#[derive(Debug, Default)]
struct Floor {
    generations: Vec<u32>,
    free: Vec<u32>,
    pos: Vec<Option<Pos>>,
    vel: Vec<Option<Vel>>,
    hunger: Vec<Option<Hunger>>,
}

impl Floor {
    fn spawn(&mut self, (pos, hunger, vel): Row) -> Slot {
        let index = self.free.pop().unwrap_or_else(|| {
            self.generations.push(0);
            self.pos.push(None);
            self.vel.push(None);
            self.hunger.push(None);
            u32::try_from(self.generations.len() - 1).expect("fewer than 2^32 slots")
        });
        let at = index as usize;
        self.pos[at] = Some(pos);
        self.vel[at] = vel;
        self.hunger[at] = Some(hunger);
        Slot {
            index,
            generation: self.generations[at],
        }
    }

    fn despawn(&mut self, s: Slot) -> Row {
        let at = s.index as usize;
        assert_eq!(self.generations[at], s.generation, "stale slot");
        self.generations[at] += 1;
        self.free.push(s.index);
        (
            self.pos[at].take().expect("alive slot has a position"),
            self.hunger[at].take().expect("alive slot has a hunger"),
            self.vel[at].take(),
        )
    }

    fn row(&self, s: Slot) -> Row {
        let at = s.index as usize;
        assert_eq!(self.generations[at], s.generation, "stale slot");
        (
            self.pos[at].expect("alive slot has a position"),
            self.hunger[at].expect("alive slot has a hunger"),
            self.vel[at],
        )
    }
}

#[derive(Debug)]
pub struct Dense {
    floors: [Floor; 2],
    index: Vec<(u8, Slot)>,
}

impl Backend for Dense {
    const NAME: &'static str = "dense";

    fn populate(n: u32) -> Self {
        let mut floor = Floor::default();
        let index = (0..n).map(|i| (0, floor.spawn(seed_row(i)))).collect();
        Self {
            floors: [floor, Floor::default()],
            index,
        }
    }

    fn churn(&mut self, picks: &[u32]) {
        for &p in picks {
            let (floor, s) = self.index[p as usize];
            let floor = &mut self.floors[usize::from(floor)];
            let (pos, hunger, vel) = floor.despawn(s);
            self.index[p as usize].1 = floor.spawn((pos, Hunger(hunger.0.saturating_add(1)), vel));
        }
    }

    fn actor_turn(&mut self, picks: &[u32]) -> u64 {
        let mut sum = 0_u64;
        for &p in picks {
            let (floor, s) = self.index[p as usize];
            let floor = &mut self.floors[usize::from(floor)];
            let at = s.index as usize;
            assert_eq!(floor.generations[at], s.generation, "stale slot");
            let x = floor.pos[at].expect("alive slot has a position").x;
            let hunger = floor.hunger[at].as_mut().expect("alive slot has a hunger");
            sum = sum
                .wrapping_add(u64::from(x.cast_unsigned()))
                .wrapping_add(u64::from(hunger.0));
            hunger.0 = hunger.0.saturating_sub(1);
        }
        sum
    }

    fn bulk(&mut self) {
        for floor in &mut self.floors {
            for hunger in floor.hunger.iter_mut().flatten() {
                hunger.0 = hunger.0.saturating_sub(1);
            }
        }
    }

    fn query(&mut self) {
        for floor in &mut self.floors {
            for (pos, vel) in floor.pos.iter_mut().zip(&floor.vel) {
                if let (Some(pos), Some(vel)) = (pos, vel) {
                    pos.x = pos.x.wrapping_add(vel.dx);
                    pos.y = pos.y.wrapping_add(vel.dy);
                }
            }
        }
    }

    fn travel(&mut self, picks: &[u32]) {
        for &p in picks {
            let (from, s) = self.index[p as usize];
            let to = 1 - from;
            let row = self.floors[usize::from(from)].despawn(s);
            self.index[p as usize] = (to, self.floors[usize::from(to)].spawn(row));
        }
    }

    fn checksum(&self) -> u64 {
        (0..).zip(&self.index).fold(0_u64, |sum, (i, &(floor, s))| {
            let (pos, hunger, vel) = self.floors[usize::from(floor)].row(s);
            sum.wrapping_add(digest(i, floor, pos, hunger, vel))
        })
    }
}
