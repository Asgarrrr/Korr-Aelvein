use korr_ecs::{Component, ImageError, Reader, Writer};
use korr_grid::{Layer, Pos};

/// Where an entity stands and which list it joins: the source the grid is rebuilt from.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Spot {
    pub(crate) pos: Pos,
    pub(crate) layer: Layer,
}

impl Component for Spot {
    fn write(&self, w: &mut Writer) {
        w.write_i16(self.pos.x);
        w.write_i16(self.pos.y);
        w.write_u8(match self.layer {
            Layer::Actor => 0,
            Layer::Thing => 1,
        });
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        let pos = Pos {
            x: r.read_i16()?,
            y: r.read_i16()?,
        };
        let layer = match r.read_u8()? {
            0 => Layer::Actor,
            1 => Layer::Thing,
            _ => return Err(ImageError::Corrupt("spot layer")),
        };
        Ok(Self { pos, layer })
    }
}
