use alloc::vec;
use alloc::vec::Vec;

use crate::config::MATERIALS;
use crate::shape::{CellIdx, Interior, Shape};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Material(u8);

impl Material {
    pub const WALL: Self = Self(0);
    pub const GROUND: Self = Self(1);

    pub(crate) const fn from_id(id: u8) -> Option<Self> {
        if (id as usize) < MATERIALS.len() {
            Some(Self(id))
        } else {
            None
        }
    }

    pub(crate) const fn id(self) -> u8 {
        self.0
    }

    #[inline]
    pub(crate) fn walkable(self) -> bool {
        MATERIALS[usize::from(self.0)].walkable
    }
}

/// Padded: the ring is `WALL`.
#[derive(Debug)]
pub(crate) struct Terrain {
    material: Vec<Material>,
    height: Vec<i8>,
}

impl Terrain {
    pub(crate) fn new(shape: Shape) -> Self {
        let width = usize::from(shape.width());
        let mut material = vec![Material::WALL; shape.cell_count()];
        for row in material
            .chunks_exact_mut(width)
            .skip(1)
            .take(usize::from(shape.height()) - 2)
        {
            row[1..width - 1].fill(Material::GROUND);
        }
        Self {
            material,
            height: vec![0; shape.cell_count()],
        }
    }

    #[inline]
    pub(crate) fn material(&self, at: CellIdx) -> Material {
        self.material[at.index()]
    }

    #[inline]
    pub(crate) fn height(&self, at: CellIdx) -> i8 {
        self.height[at.index()]
    }

    pub(crate) fn set_material(&mut self, at: Interior, m: Material) {
        self.material[at.cell().index()] = m;
    }

    pub(crate) fn set_height(&mut self, at: Interior, h: i8) {
        self.height[at.cell().index()] = h;
    }
}
