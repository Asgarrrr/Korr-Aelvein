use alloc::vec;
use alloc::vec::Vec;

use korr_ecs::{ImageError, Reader, Writer};

use crate::grid::Grid;
use crate::shape::{Interior, Pos, Shape};

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

/// What a cell walk reads at one cell: the previous round's column and the terrain.
#[derive(Debug, Clone, Copy)]
pub struct Stencil<'a> {
    prev: &'a [u8],
    at: usize,
    width: usize,
    walkable: bool,
    pos: Pos,
}

impl Stencil<'_> {
    #[must_use]
    #[inline]
    pub fn value(self) -> u8 {
        self.prev[self.at]
    }

    /// The material alone: an actor on the cell does not change it.
    #[must_use]
    #[inline]
    pub fn walkable(self) -> bool {
        self.walkable
    }

    /// The eight surrounding cells, previous round, in [`Dir::ALL`](crate::Dir::ALL) order.
    /// The ring is 0, so an edge cell needs no check.
    #[must_use]
    #[inline]
    pub fn neighbours(self) -> [u8; 8] {
        let (at, up, down) = (self.at, self.at - self.width, self.at + self.width);
        let p = self.prev;
        [
            p[up - 1],
            p[up],
            p[up + 1],
            p[at - 1],
            p[at + 1],
            p[down - 1],
            p[down],
            p[down + 1],
        ]
    }

    #[must_use]
    #[inline]
    pub fn pos(self) -> Pos {
        self.pos
    }
}

impl Grid {
    /// Fills every interior cell of `next` with `f` of that cell in `prev`; the ring stays 0.
    ///
    /// # Panics
    /// When `prev` or `next` has another shape than this grid.
    #[inline]
    pub fn stencil(&self, prev: &CellColumn, next: &mut CellColumn, f: impl Fn(Stencil<'_>) -> u8) {
        assert_eq!(prev.shape, self.shape(), "cell column of another floor");
        assert_eq!(next.shape, self.shape(), "cell column of another floor");
        let (width, height) = sides(self.shape());
        let rows = next.cells.chunks_exact_mut(width);
        let materials = self.terrain.materials().chunks_exact(width);
        let rows = rows.zip(materials).zip(0..self.shape().height());
        for ((row, materials), y) in rows.skip(1).take(height - 2) {
            for x in 1..self.shape().width() - 1 {
                let column = usize::from(x);
                row[column] = f(Stencil {
                    prev: &prev.cells,
                    at: usize::from(y) * width + column,
                    width,
                    walkable: materials[column].walkable(),
                    pos: Pos {
                        x: x.cast_signed(),
                        y: y.cast_signed(),
                    },
                });
            }
        }
    }
}

fn sides(shape: Shape) -> (usize, usize) {
    (usize::from(shape.width()), usize::from(shape.height()))
}

#[cfg(test)]
mod tests {
    use super::{CellColumn, Stencil};
    use crate::grid::Grid;
    use crate::shape::{Dir, Pos, Shape};
    use crate::terrain::Material;

    /// Not square, with walls: a walk that pairs a value with the wrong cell differs.
    fn setup() -> (Grid, CellColumn) {
        let shape = Shape::new(10, 7).expect("fits the bounds");
        let mut grid = Grid::new(shape);
        let mut column = CellColumn::new(shape);
        for y in 1..6 {
            for x in 1..9 {
                let at = shape.idx(Pos { x, y }).expect("interior");
                column.set(at, u8::try_from(x * 16 + y).expect("fits u8"));
                if (x + 2 * y) % 3 == 0 {
                    grid.set_material(at, Material::WALL);
                }
            }
        }
        (grid, column)
    }

    fn rule(cell: Stencil<'_>) -> u8 {
        let around = cell
            .neighbours()
            .iter()
            .fold(0u8, |a, &n| a.wrapping_add(n));
        if cell.walkable() {
            cell.value().wrapping_mul(3).wrapping_add(around)
        } else {
            (cell.value() / 2 + 1) ^ around
        }
    }

    /// Cell by cell, from the last interior cell to the first, each from the
    /// pairs of `prev` that `Pos` names.
    fn reversed(grid: &Grid, prev: &CellColumn, f: impl Fn(Stencil<'_>) -> u8) -> CellColumn {
        let shape = grid.shape();
        let mut next = CellColumn::new(shape);
        let last = |side: u16| side.cast_signed() - 2;
        for y in (1..=last(shape.height())).rev() {
            for x in (1..=last(shape.width())).rev() {
                let at = shape.idx(Pos { x, y }).expect("interior");
                let cell = Stencil {
                    prev: &prev.cells,
                    at: at.cell().index(),
                    width: usize::from(shape.width()),
                    walkable: grid.terrain.material(at.cell()).walkable(),
                    pos: Pos { x, y },
                };
                next.set(at, f(cell));
            }
        }
        next
    }

    #[test]
    fn the_walk_order_never_changes_the_column() {
        let (grid, prev) = setup();
        let mut forward = CellColumn::new(grid.shape());
        grid.stencil(&prev, &mut forward, rule);
        assert_eq!(forward.cells, reversed(&grid, &prev, rule).cells);
    }

    #[test]
    fn neighbours_follow_dir_all_in_the_previous_column() {
        let (grid, prev) = setup();
        let shape = grid.shape();
        for y in 1..=5 {
            for x in 1..=8 {
                let cell = Stencil {
                    prev: &prev.cells,
                    at: shape.idx(Pos { x, y }).expect("interior").cell().index(),
                    width: usize::from(shape.width()),
                    walkable: true,
                    pos: Pos { x, y },
                };
                let neighbours = cell.neighbours();
                for (i, dir) in Dir::ALL.into_iter().enumerate() {
                    let (dx, dy) = dir.offset();
                    let around = shape.idx(Pos {
                        x: x + dx,
                        y: y + dy,
                    });
                    let expected = around.map_or(0, |n| prev.get(n));
                    assert_eq!(neighbours[i], expected, "({x}, {y}) {dir:?}");
                }
            }
        }
    }
}
