//! The same five workloads on korr-ecs, hecs, `bevy_ecs` and a dense-column
//! candidate, so the storage decision can be reproduced. Results are in
//! `docs/plans/rust-structure.md`, section 7.

use std::num::NonZeroU32;

use korr_ecs::{Component, ImageError, Reader, Writer};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

pub mod bevy_world;
pub mod dense;
pub mod hecs_world;
pub mod ours;

#[derive(Debug, Clone, Copy, PartialEq, Eq, bevy_ecs::component::Component)]
pub struct Pos {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, bevy_ecs::component::Component)]
pub struct Vel {
    pub dx: i32,
    pub dy: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, bevy_ecs::component::Component)]
pub struct Hunger(pub u16);

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

impl Component for Vel {
    fn write(&self, w: &mut Writer) {
        w.write_i32(self.dx);
        w.write_i32(self.dy);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self {
            dx: r.read_i32()?,
            dy: r.read_i32()?,
        })
    }
}

impl Component for Hunger {
    fn write(&self, w: &mut Writer) {
        w.write_u16(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u16().map(Self)
    }
}

/// `k` indices in `0..n`, drawn from `seed`; repeats are possible.
///
/// # Panics
/// When `n` is zero.
#[must_use]
pub fn picks(seed: u64, n: u32, k: u32) -> Vec<u32> {
    let stream = Stream::new(Seed(seed), ModuleKey::of("ecs-bench"), Phase::Action, 0);
    let bound = NonZeroU32::new(n).expect("n is not zero");
    (0..k)
        .map(|i| stream.below(Subject::Entity(u64::from(i)), DrawIndex(0), bound))
        .collect()
}

/// One entity's state as a hash, equal across backends for equal state.
#[must_use]
pub fn digest(i: u32, floor: u8, pos: Pos, hunger: Hunger, vel: Option<Vel>) -> u64 {
    let (has_vel, dx, dy) = vel.map_or((0, 0, 0), |v| (1, v.dx, v.dy));
    [
        i.into(),
        floor.into(),
        pos.x.cast_unsigned().into(),
        pos.y.cast_unsigned().into(),
        hunger.0.into(),
        has_vel,
        dx.cast_unsigned().into(),
        dy.cast_unsigned().into(),
    ]
    .into_iter()
    .fold(0xcbf2_9ce4_8422_2325_u64, |h: u64, v: u64| {
        (h ^ v).wrapping_mul(0x100_0000_01b3).rotate_left(23)
    })
}

/// Entity `i` starts with a position, a hunger and, when `i` is even, a velocity.
///
/// # Panics
/// When `i` does not fit `i32`.
#[must_use]
pub fn seed_row(i: u32) -> (Pos, Hunger, Option<Vel>) {
    let i = i32::try_from(i).expect("entity index fits i32");
    let vel = (i % 2 == 0).then_some(Vel { dx: 1, dy: 2 });
    (
        Pos { x: i, y: -i },
        Hunger(u16::try_from(i % 100 + 1).expect("below 101")),
        vel,
    )
}

pub trait Backend: Sized {
    const NAME: &'static str;

    /// `n` entities on floor 0. Entity `i` has `seed_row(i)`.
    fn populate(n: u32) -> Self;

    /// For each pick: despawn entity `p`, then spawn a replacement on the
    /// same floor with the same position and velocity, and hunger plus one.
    fn churn(&mut self, picks: &[u32]);

    /// For each pick: read position and hunger by handle, add `x + hunger`
    /// to the sum, then lower hunger by one. The random-access workload.
    fn actor_turn(&mut self, picks: &[u32]) -> u64;

    /// Lower every hunger on every floor by one.
    fn bulk(&mut self);

    /// Add the velocity to the position of every entity that has both.
    fn query(&mut self);

    /// Move each picked entity to the other of the two floors.
    fn travel(&mut self, picks: &[u32]);

    /// Wrapping sum of `digest` over every entity, in index order.
    fn checksum(&self) -> u64;
}
