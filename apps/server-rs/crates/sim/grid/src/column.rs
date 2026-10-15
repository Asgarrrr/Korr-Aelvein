use alloc::vec;
use alloc::vec::Vec;
use core::ops::RangeInclusive;

use korr_ecs::{ImageError, Reader, Writer};

use crate::grid::Grid;
use crate::shape::{Interior, Pos, Shape};
use crate::terrain::Material;

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

    /// The interior cells within Chebyshev distance `radius` of `centre`, one
    /// slice per row from the top, each with the position of its first cell.
    /// `centre` may lie off the floor.
    pub fn window(&self, centre: Pos, radius: u16) -> impl Iterator<Item = (Pos, &[u8])> {
        let width = usize::from(self.shape.width());
        let (xs, ys) = self.shape.window(centre, radius);
        let (start, end) = xs.into_inner();
        // Off the interior the span is empty and may end below 0: no row then.
        let ys = if start <= end {
            ys
        } else {
            RangeInclusive::new(1, 0)
        };
        // Read only on a non-empty span, which lies within the interior.
        let index = |v: i16| usize::from(v.unsigned_abs());
        let (from, to) = (index(start), index(end));
        ys.map(move |y| {
            let row = index(y) * width;
            let first = Pos { x: start, y };
            (first, &self.cells[row + from..=row + to])
        })
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
    materials: &'a [Material],
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
        self.materials[self.at].walkable()
    }

    /// The eight surrounding cells, previous round, in [`Dir::ALL`](crate::Dir::ALL) order.
    /// The ring is 0, so an edge cell needs no check.
    #[must_use]
    #[inline]
    pub fn neighbours(self) -> [u8; 8] {
        self.around().map(|i| self.prev[i])
    }

    /// Whether each surrounding cell is walkable, in the order of [`Stencil::neighbours`].
    #[must_use]
    #[inline]
    pub fn walkable_neighbours(self) -> [bool; 8] {
        self.around().map(|i| self.materials[i].walkable())
    }

    fn around(self) -> [usize; 8] {
        let (at, up, down) = (self.at, self.at - self.width, self.at + self.width);
        [up - 1, up, up + 1, at - 1, at + 1, down - 1, down, down + 1]
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
        let materials = self.terrain.materials();
        let rows = rows.zip(0..self.shape().height());
        for (row, y) in rows.skip(1).take(height - 2) {
            for x in 1..self.shape().width() - 1 {
                let column = usize::from(x);
                row[column] = f(Stencil {
                    prev: &prev.cells,
                    at: usize::from(y) * width + column,
                    width,
                    materials,
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
    use alloc::vec::Vec;

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
                    materials: grid.terrain.materials(),
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
    fn neighbours_and_their_ground_follow_dir_all() {
        let (grid, prev) = setup();
        let shape = grid.shape();
        for y in 1..=5 {
            for x in 1..=8 {
                let cell = Stencil {
                    prev: &prev.cells,
                    at: shape.idx(Pos { x, y }).expect("interior").cell().index(),
                    width: usize::from(shape.width()),
                    materials: grid.terrain.materials(),
                    pos: Pos { x, y },
                };
                let (neighbours, walkable) = (cell.neighbours(), cell.walkable_neighbours());
                for (i, dir) in Dir::ALL.into_iter().enumerate() {
                    let (dx, dy) = dir.offset();
                    let around = shape.idx(Pos {
                        x: x + dx,
                        y: y + dy,
                    });
                    let expected = around.map_or(0, |n| prev.get(n));
                    assert_eq!(neighbours[i], expected, "({x}, {y}) {dir:?}");
                    let ground = around.is_some_and(|n| grid.terrain.material(n.cell()).walkable());
                    assert_eq!(walkable[i], ground, "({x}, {y}) {dir:?}");
                }
            }
        }
    }

    #[test]
    fn a_window_holds_the_neighbourhood_row_by_row() {
        let (grid, column) = setup();
        let shape = grid.shape();
        for radius in 0..=3 {
            for y in 1..=5 {
                for x in 1..=8 {
                    let centre = Pos { x, y };
                    let window: Vec<_> = column
                        .window(centre, radius)
                        .flat_map(|(first, row)| {
                            (first.x..).zip(row).map(move |(x, &v)| (first.y, x, v))
                        })
                        .collect();
                    let mut around: Vec<_> = shape
                        .neighbourhood(centre, radius)
                        .map(|at| (shape.pos(at.cell()), column.get(at)))
                        .map(|(pos, v)| (pos.y, pos.x, v))
                        .collect();
                    around.sort_unstable();
                    assert_eq!(window, around, "({x}, {y}) radius {radius}");
                }
            }
        }
    }
}
