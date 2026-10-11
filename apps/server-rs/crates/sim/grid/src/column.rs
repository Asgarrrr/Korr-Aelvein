use alloc::vec;
use alloc::vec::Vec;

use korr_ecs::{ImageError, Reader, Writer};

use crate::shape::{Interior, Shape};

/// One `u8` per cell of one floor, padded like the terrain: the ring stays 0.
#[derive(Debug)]
pub struct CellColumn {
    shape: Shape,
    cells: Vec<u8>,
}

impl CellColumn {
    #[must_use]
    pub fn new(shape: Shape) -> Self {
        Self {
            shape,
            cells: vec![0; shape.cell_count()],
        }
    }

    /// # Panics
    /// When `at` is not an interior cell of this floor.
    #[must_use]
    pub fn get(&self, at: Interior) -> u8 {
        self.shape.check_interior(at);
        self.cells[at.cell().index()]
    }

    /// # Panics
    /// When `at` is not an interior cell of this floor.
    pub fn set(&mut self, at: Interior, value: u8) {
        self.shape.check_interior(at);
        self.cells[at.cell().index()] = value;
    }

    /// The interior cells, one byte each, in row-major order like `Grid::write`.
    pub fn write(&self, w: &mut Writer) {
        let (width, height) = sides(self.shape);
        for row in self.cells.chunks_exact(width).skip(1).take(height - 2) {
            w.write_bytes(&row[1..width - 1]);
        }
    }

    /// Reads what [`CellColumn::write`] wrote for `shape`. Every byte is a valid
    /// value. Never panics.
    ///
    /// # Errors
    /// [`ImageError::Truncated`] when fewer bytes remain than `shape` has interior cells.
    pub fn read(r: &mut Reader<'_>, shape: Shape) -> Result<Self, ImageError> {
        let (width, height) = sides(shape);
        // Read before any allocation: a forged shape cannot reserve memory.
        let bytes = r.read_bytes((width - 2) * (height - 2))?;
        let mut column = Self::new(shape);
        let rows = column.cells.chunks_exact_mut(width).skip(1);
        for (row, saved) in rows.zip(bytes.chunks_exact(width - 2)) {
            row[1..width - 1].copy_from_slice(saved);
        }
        Ok(column)
    }
}

fn sides(shape: Shape) -> (usize, usize) {
    (usize::from(shape.width()), usize::from(shape.height()))
}
