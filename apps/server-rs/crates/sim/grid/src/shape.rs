/// One interior cell inside the wall ring.
const MIN_SIDE: u16 = 3;
/// Every position of the shape fits `i16`.
const MAX_SIDE: u16 = i16::MAX.unsigned_abs();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pos {
    pub x: i16,
    pub y: i16,
}

/// Any cell of the padded frame, ring included, in row-major order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CellIdx(u32);

impl CellIdx {
    #[inline]
    pub(crate) const fn index(self) -> usize {
        self.0 as usize
    }
}

/// A cell inside the wall ring: its 8 neighbours are in bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Interior(CellIdx);

impl Interior {
    /// The ring is never walkable, so a walkable cell is interior.
    #[inline]
    pub(crate) const fn of_walkable(cell: CellIdx) -> Self {
        Self(cell)
    }

    #[must_use]
    #[inline]
    pub const fn cell(self) -> CellIdx {
        self.0
    }
}

/// A floor's size, wall ring included.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    width: u16,
    height: u16,
}

impl Shape {
    /// `None` unless both sides are within `3..=i16::MAX`.
    #[must_use]
    pub const fn new(width: u16, height: u16) -> Option<Self> {
        if width < MIN_SIDE || width > MAX_SIDE || height < MIN_SIDE || height > MAX_SIDE {
            return None;
        }
        Some(Self { width, height })
    }

    #[must_use]
    #[inline]
    pub const fn width(self) -> u16 {
        self.width
    }

    #[must_use]
    #[inline]
    pub const fn height(self) -> u16 {
        self.height
    }

    pub(crate) fn cell_count(self) -> usize {
        usize::from(self.width) * usize::from(self.height)
    }

    /// `None` on the ring and outside the shape.
    #[must_use]
    pub fn idx(self, p: Pos) -> Option<Interior> {
        let x = u16::try_from(p.x).ok()?;
        let y = u16::try_from(p.y).ok()?;
        if x == 0 || y == 0 || x > self.width - 2 || y > self.height - 2 {
            return None;
        }
        Some(Interior(CellIdx(
            u32::from(y) * u32::from(self.width) + u32::from(x),
        )))
    }

    /// # Panics
    /// When the row or column of `at` does not fit an `i16`. A `CellIdx` from a
    /// smaller or larger shape otherwise gives a wrong `Pos`.
    #[must_use]
    pub fn pos(self, at: CellIdx) -> Pos {
        let width = u32::from(self.width);
        let coord = |v: u32| i16::try_from(v).expect("a cell of this shape has an i16 position");
        Pos {
            x: coord(at.0 % width),
            y: coord(at.0 / width),
        }
    }

    /// `false` when `at` was minted by a shape of another size and lands on this ring or past it.
    pub(crate) fn holds(self, at: Interior) -> bool {
        let width = u32::from(self.width);
        let (x, y) = (at.0.0 % width, at.0.0 / width);
        (1..width - 1).contains(&x) && (1..u32::from(self.height) - 1).contains(&y)
    }

    /// The nearest interior position.
    #[must_use]
    pub fn clamp(self, p: Pos) -> Pos {
        // Lossless: `Shape::new` caps each side at `i16::MAX`.
        let last = |side: u16| side.cast_signed() - 2;
        Pos {
            x: p.x.clamp(1, last(self.width)),
            y: p.y.clamp(1, last(self.height)),
        }
    }

    /// The interior cells within Chebyshev distance `radius` of `centre`, ring by
    /// ring, row-major within a ring. `centre` may lie off the floor.
    pub fn neighbourhood(self, centre: Pos, radius: u16) -> impl Iterator<Item = Interior> {
        let (cx, cy) = (i32::from(centre.x), i32::from(centre.y));
        let (last_x, last_y) = (i32::from(self.width) - 2, i32::from(self.height) - 2);
        let row = move |y: i32, left: i32, right: i32| {
            (1..=last_y)
                .contains(&y)
                .then(|| (left.max(1)..=right.min(last_x)).map(move |x| (x, y)))
                .into_iter()
                .flatten()
        };
        (0..=i32::from(radius))
            .flat_map(move |d| {
                let (left, right) = (cx - d, cx + d);
                let sides = ((cy - d + 1).max(1)..=(cy + d - 1).min(last_y)).flat_map(move |y| {
                    [left, right]
                        .into_iter()
                        .filter(move |x| (1..=last_x).contains(x))
                        .map(move |x| (x, y))
                });
                let bottom = (d > 0).then_some(cy + d).into_iter();
                row(cy - d, left, right)
                    .chain(sides)
                    .chain(bottom.flat_map(move |y| row(y, left, right)))
            })
            .map(move |(x, y)| {
                Interior(CellIdx(
                    y.unsigned_abs() * u32::from(self.width) + x.unsigned_abs(),
                ))
            })
    }

    #[must_use]
    #[inline]
    pub fn neighbour(self, at: Interior, dir: Dir) -> CellIdx {
        let (dx, dy) = dir.offset();
        let delta = i32::from(dy) * i32::from(self.width) + i32::from(dx);
        // The wall ring keeps every neighbour of an interior cell in bounds: no wrap.
        CellIdx(at.0.0.wrapping_add_signed(delta))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dir {
    NorthWest,
    North,
    NorthEast,
    West,
    East,
    SouthWest,
    South,
    SouthEast,
}

impl Dir {
    /// Row-major; y grows down.
    pub const ALL: [Self; 8] = [
        Self::NorthWest,
        Self::North,
        Self::NorthEast,
        Self::West,
        Self::East,
        Self::SouthWest,
        Self::South,
        Self::SouthEast,
    ];

    /// `(dx, dy)`.
    #[must_use]
    pub const fn offset(self) -> (i16, i16) {
        match self {
            Self::NorthWest => (-1, -1),
            Self::North => (0, -1),
            Self::NorthEast => (1, -1),
            Self::West => (-1, 0),
            Self::East => (1, 0),
            Self::SouthWest => (-1, 1),
            Self::South => (0, 1),
            Self::SouthEast => (1, 1),
        }
    }
}
