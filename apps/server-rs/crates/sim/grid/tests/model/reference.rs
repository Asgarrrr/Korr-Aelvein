use std::collections::{BTreeMap, BTreeSet};

use korr_ecs::EntityId;
use korr_grid::{CellIdx, Layer, Pos, Shape};

/// A floor index and a cell of that floor.
pub(crate) type Cell = (usize, CellIdx);

/// A `BTreeMap` model of the terrain, who stands where and what lies there.
#[derive(Default)]
pub(crate) struct Reference {
    /// A walkable flag and a height per interior cell.
    terrain: BTreeMap<Cell, (bool, i8)>,
    occupant: BTreeMap<Cell, EntityId>,
    things: BTreeMap<Cell, BTreeSet<EntityId>>,
}

impl Reference {
    pub(crate) fn set_terrain(&mut self, cell: Cell, walkable: bool, height: i8) {
        self.terrain.insert(cell, (walkable, height));
    }

    pub(crate) fn terrain(&self, cell: Cell) -> (bool, i8) {
        self.terrain[&cell]
    }

    pub(crate) fn cells(&self, floor: usize) -> impl Iterator<Item = CellIdx> + '_ {
        self.terrain
            .keys()
            .filter(move |&&(f, _)| f == floor)
            .map(|&(_, cell)| cell)
    }

    pub(crate) fn can_place(&self, cell: Cell, layer: Layer) -> bool {
        self.terrain[&cell].0 && (layer == Layer::Thing || !self.occupant.contains_key(&cell))
    }

    /// The placeable cell nearest the clamped `from`, by Chebyshev distance, then row, then column.
    pub(crate) fn nearest(
        &self,
        floor: usize,
        shape: Shape,
        from: Pos,
        layer: Layer,
    ) -> Option<CellIdx> {
        let last = |side: u16| i16::try_from(side).expect("a model side fits i16") - 2;
        let centre = Pos {
            x: from.x.clamp(1, last(shape.width())),
            y: from.y.clamp(1, last(shape.height())),
        };
        self.cells(floor)
            .filter(|&cell| self.can_place((floor, cell), layer))
            .map(|cell| (shape.pos(cell), cell))
            .min_by_key(|&(p, _)| {
                let distance = (p.x - centre.x).abs().max((p.y - centre.y).abs());
                (distance, p.y, p.x)
            })
            .map(|(_, cell)| cell)
    }

    pub(crate) fn actor(&self, cell: Cell) -> Option<EntityId> {
        self.occupant.get(&cell).copied()
    }

    /// Ascending `EntityId`.
    pub(crate) fn things(&self, cell: Cell) -> Vec<EntityId> {
        self.things
            .get(&cell)
            .into_iter()
            .flatten()
            .copied()
            .collect()
    }

    pub(crate) fn place(&mut self, cell: Cell, layer: Layer, id: EntityId) {
        match layer {
            Layer::Actor => {
                self.occupant.insert(cell, id);
            }
            Layer::Thing => {
                self.things.entry(cell).or_default().insert(id);
            }
        }
    }

    pub(crate) fn remove(&mut self, cell: Cell, layer: Layer, id: EntityId) {
        match layer {
            Layer::Actor => {
                self.occupant.remove(&cell);
            }
            Layer::Thing => {
                self.things
                    .get_mut(&cell)
                    .expect("a linked thing has a cell set")
                    .remove(&id);
            }
        }
    }
}
