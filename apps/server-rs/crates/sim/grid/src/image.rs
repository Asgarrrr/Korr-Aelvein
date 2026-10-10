//! Shape and interior terrain only: the ring is regenerated and occupancy
//! is rebuilt from positions. The core's floor image carries the header and checksum.

use korr_ecs::{Handle, ImageError, Reader, Store, Writer};

use crate::grid::Grid;
use crate::occupancy::Layer;
use crate::shape::{Interior, Pos, Shape};
use crate::terrain::Material;

impl Grid {
    /// Width and height as `u16`, then the interior materials, then the
    /// interior heights, each one byte per cell in row-major order.
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
    }

    /// Reads what [`Grid::write`] wrote and links each of `placed`, things in
    /// ascending `EntityId` whatever the input order. Never calls `Reader::finish`.
    ///
    /// # Errors
    /// [`ImageError::Truncated`] when the bytes run out, or [`ImageError::Corrupt`] with:
    /// - `"floor shape"`: a side outside `3..=i16::MAX`;
    /// - `"material"`: an id outside the material table;
    /// - `"position off the floor"`: a placed position outside the shape or on the ring;
    /// - `"two actors on one cell"`.
    ///
    /// # Panics
    /// When a placed handle is dead on `store` or placed twice: the caller
    /// derives `placed` from its own live entities.
    pub fn read(
        r: &mut Reader<'_>,
        store: &Store,
        placed: impl IntoIterator<Item = (Handle, Pos, Layer)>,
    ) -> Result<Self, ImageError> {
        let width = r.read_u16()?;
        let height = r.read_u16()?;
        let shape = Shape::new(width, height).ok_or(ImageError::Corrupt("floor shape"))?;
        let cells = usize::from(width - 2) * usize::from(height - 2);
        // Both layers are read before any allocation: a forged shape cannot reserve memory.
        let materials = r.read_bytes(cells)?;
        let heights = r.read_bytes(cells)?;
        if materials.iter().any(|&id| Material::from_id(id).is_none()) {
            return Err(ImageError::Corrupt("material"));
        }
        let mut grid = Self::new(shape);
        for ((at, &id), &h) in interior(shape).zip(materials).zip(heights) {
            let m = Material::from_id(id).expect("material ids are checked before the copy");
            grid.set_material(at, m);
            grid.set_height(at, i8::from_le_bytes([h]));
        }
        for (h, pos, layer) in placed {
            let at = shape
                .idx(pos)
                .ok_or(ImageError::Corrupt("position off the floor"))?;
            match layer {
                Layer::Actor => {
                    if grid.actor_at(at.cell()).is_some() {
                        return Err(ImageError::Corrupt("two actors on one cell"));
                    }
                    grid.link_actor(store, h, at);
                }
                Layer::Thing => grid.link_thing(store, h, at),
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
