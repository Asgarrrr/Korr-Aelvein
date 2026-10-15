use korr_ecs::{Component, EntityId, Handle, ImageError, Reader, Writer};
use korr_random::ModuleKey;

/// Core-owned: health changes only through a harm the core applies. `hp`
/// above `max` is accepted unchecked: a harm only lowers `hp`, and remains
/// weigh `max`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Vitality {
    pub hp: u16,
    pub max: u16,
}

impl Component for Vitality {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u16(self.hp);
        w.write_u16(self.max);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self {
            hp: r.read_u16()?,
            max: r.read_u16()?,
        })
    }
}

/// What a death leaves: a thing of its own, rotting each round.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Remains {
    pub of: EntityId,
    pub mass: u16,
}

impl Component for Remains {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u64(self.of.to_bits());
        w.write_u16(self.mass);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self {
            of: EntityId::from_bits(r.read_u64()?).ok_or(ImageError::Corrupt("remains of"))?,
            mass: r.read_u16()?,
        })
    }
}

/// A death is credited to the lowest cause of its harms, so `Entity` comes first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Cause {
    Entity(EntityId),
    Mechanic(ModuleKey),
}

/// A harm waiting for the next drain.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Harm {
    pub(crate) target: EntityId,
    pub(crate) h: Handle,
    pub(crate) cause: Cause,
    pub(crate) amount: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    Died { id: EntityId, cause: Cause },
    Spawned { id: EntityId, cause: Cause },
}
