//! Shape, interior terrain and placement records: the ring is regenerated and
//! the cell indexes are rebuilt from the records, the source of position.
//! The core's floor image carries the header and checksum.

use alloc::vec::Vec;

use korr_ecs::{EntityId, Handle, ImageError, Reader, Writer};

use crate::grid::Grid;
use crate::occupancy::Layer;
use crate::shape::{Interior, Pos, Shape};
use crate::terrain::Material;

const ACTOR: u8 = 0;
const THING: u8 = 1;

impl Grid {
    /// Width and height as `u16`, then the interior materials, then the
    /// interior heights, each one byte per cell in row-major order. Then a
    /// `u32` record count and one record per placed entity in strictly
    /// ascending `EntityId`: `u64` id bits, `u8` layer (0 actor, 1 thing),
    /// `i16` x, `i16` y.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "records are indexed by u32 slots, so their count fits u32"
    )]
    pub fn write(&self, w: &mut Writer) {
        let shape = self.shape();
        w.write_u16(shape.width());
        w.write_u16(shape.height());
        for at in interior(shape) {
            w.write_u8(self.terrain.material(at.cell()).id());
        }
        for at in interior(shape) {
            w.write_i8(self.terrain.height(at.cell()));
        }
        let mut records: Vec<_> = self.occupancy.records().collect();
        records.sort_unstable_by_key(|&(id, _, _)| id);
        w.write_u32(records.len() as u32);
        for (id, layer, at) in records {
            let p = shape.pos(at.cell());
            w.write_u64(id.to_bits());
            w.write_u8(match layer {
                Layer::Actor => ACTOR,
                Layer::Thing => THING,
            });
            w.write_i16(p.x);
            w.write_i16(p.y);
        }
    }

    /// Reads what [`Grid::write`] wrote and links each record's entity on the
    /// handle `resolve` maps its id to. Never calls `Reader::finish`. When
    /// `resolve` maps distinct ids to distinct live handles, never panics.
    ///
    /// # Errors
    /// [`ImageError::Truncated`] when the bytes run out, or [`ImageError::Corrupt`] with:
    /// - `"floor shape"`: a side outside `3..=i16::MAX`;
    /// - `"material"`: an id outside the material table;
    /// - `"entity id"`: record id bits that name no `EntityId`;
    /// - `"placement order"`: a record id not above the previous one;
    /// - `"placement of an absent entity"`: a record id `resolve` maps to no handle;
    /// - `"layer"`: a layer byte other than 0 and 1;
    /// - `"position off the floor"`: a record position outside the shape or on the ring;
    /// - `"two actors on one cell"`.
    pub fn read(
        r: &mut Reader<'_>,
        mut resolve: impl FnMut(EntityId) -> Option<Handle>,
    ) -> Result<Self, ImageError> {
        let width = r.read_u16()?;
        let height = r.read_u16()?;
        let shape = Shape::new(width, height).ok_or(ImageError::Corrupt("floor shape"))?;
        let cells = usize::from(width - 2) * usize::from(height - 2);
        // Both layers are read before any allocation: a forged shape cannot reserve memory.
        let materials = r.read_bytes(cells)?;
        let heights = r.read_bytes(cells)?;
        let mut grid = Self::new(shape);
        for ((at, &id), &h) in interior(shape).zip(materials).zip(heights) {
            let m = Material::from_id(id).ok_or(ImageError::Corrupt("material"))?;
            grid.set_material(at, m);
            grid.set_height(at, i8::from_le_bytes([h]));
        }
        let mut previous = None;
        for _ in 0..r.read_u32()? {
            let bits = r.read_u64()?;
            let layer = r.read_u8()?;
            let pos = Pos {
                x: r.read_i16()?,
                y: r.read_i16()?,
            };
            let id = EntityId::from_bits(bits).ok_or(ImageError::Corrupt("entity id"))?;
            if previous.is_some_and(|previous| id <= previous) {
                return Err(ImageError::Corrupt("placement order"));
            }
            previous = Some(id);
            let h = resolve(id).ok_or(ImageError::Corrupt("placement of an absent entity"))?;
            let layer = match layer {
                ACTOR => Layer::Actor,
                THING => Layer::Thing,
                _ => return Err(ImageError::Corrupt("layer")),
            };
            let at = shape
                .idx(pos)
                .ok_or(ImageError::Corrupt("position off the floor"))?;
            match layer {
                Layer::Actor => {
                    if grid.actor_at(at.cell()).is_some() {
                        return Err(ImageError::Corrupt("two actors on one cell"));
                    }
                    grid.link_actor(h, id, at);
                }
                Layer::Thing => grid.link_thing(h, id, at),
            }
        }
        Ok(grid)
    }
}

/// Row-major.
fn interior(shape: Shape) -> impl Iterator<Item = Interior> {
    let side = |v: u16| i16::try_from(v).expect("a shape side fits i16");
    let (width, height) = (side(shape.width()), side(shape.height()));
    (1..height - 1).flat_map(move |y| {
        (1..width - 1).map(move |x| {
            shape
                .idx(Pos { x, y })
                .expect("the scan stays inside the ring")
        })
    })
}
