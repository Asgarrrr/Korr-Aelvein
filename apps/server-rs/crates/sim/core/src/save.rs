use alloc::vec::Vec;

use korr_ecs::{ImageError, Reader, Writer};

use crate::error::LoadError;
use crate::floor::Floor;
use crate::game::Game;
use crate::module::Mechanics;
use crate::world::World;

const MAGIC: &[u8; 8] = b"KORRSAV\0";
/// Versions the framing of the save and of every core image nested in it.
const VERSION: u16 = 1;

impl<M: Mechanics> Game<M> {
    /// Magic, `u16` version, `u64` seed, `u32` floor count, then per floor in ascending `FloorId` a
    /// `u32` image length and the [`Floor::save`] image. No outer checksum:
    /// each image carries its own.
    ///
    /// # Panics
    /// When a floor image exceeds `u32::MAX` bytes or the world holds more
    /// than `u32::MAX` floors.
    #[must_use]
    pub fn save(&self, world: &World) -> Vec<u8> {
        let mut floors: Vec<&Floor> = world.floors().iter().collect();
        floors.sort_unstable_by_key(|floor| floor.id());
        let mut w = Writer::new();
        w.write_bytes(MAGIC);
        w.write_u16(VERSION);
        w.write_u64(self.seed().0);
        w.write_u32(u32::try_from(floors.len()).expect("a world fits u32 floors"));
        for floor in floors {
            let image = floor.save(self.ruleset());
            w.write_u32(u32::try_from(image.len()).expect("a floor image fits u32 bytes"));
            w.write_bytes(&image);
        }
        w.into_bytes()
    }

    /// Never panics.
    ///
    /// # Errors
    /// [`LoadError::Image`] for a save of another format, truncated or overlong,
    /// [`LoadError::Seed`] when it was made under another seed, every error of
    /// [`Floor::load`], and [`LoadError::World`] from [`World::try_new`].
    pub fn load(&self, bytes: &[u8]) -> Result<World, LoadError> {
        let mut r = Reader::new(bytes);
        if r.read_bytes(MAGIC.len())? != MAGIC {
            return Err(ImageError::Magic.into());
        }
        let version = r.read_u16()?;
        if version != VERSION {
            return Err(ImageError::Version(version).into());
        }
        let saved = r.read_u64()?;
        if saved != self.seed().0 {
            return Err(LoadError::Seed {
                saved,
                running: self.seed().0,
            });
        }
        let mut floors = Vec::new();
        for _ in 0..r.read_u32()? {
            let len = r.read_u32()?;
            let floor = Floor::load(self.ruleset(), r.read_bytes(len as usize)?)?;
            if floors
                .last()
                .is_some_and(|last: &Floor| last.id() >= floor.id())
            {
                return Err(ImageError::Corrupt("floor order").into());
            }
            floors.push(floor);
        }
        r.finish()?;
        Ok(World::try_new(floors)?)
    }
}
