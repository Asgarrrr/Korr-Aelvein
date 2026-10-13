use korr_grid::{Dir, Pos, Shape};

fn shape(width: u16, height: u16) -> Shape {
    Shape::new(width, height).expect("test shapes fit the bounds")
}

fn interior(shape: Shape) -> impl Iterator<Item = Pos> {
    let width = i16::try_from(shape.width()).expect("test shapes fit i16");
    let height = i16::try_from(shape.height()).expect("test shapes fit i16");
    (1..height - 1).flat_map(move |y| (1..width - 1).map(move |x| Pos { x, y }))
}

#[test]
fn idx_refuses_ring_and_outside() {
    for (w, h) in [(3_i16, 3_i16), (7, 5)] {
        let shape = shape(w.unsigned_abs(), h.unsigned_abs());
        for y in -1..=h {
            for x in -1..=w {
                let inside = (1..=w - 2).contains(&x) && (1..=h - 2).contains(&y);
                assert_eq!(
                    shape.idx(Pos { x, y }).is_some(),
                    inside,
                    "({x}, {y}) on {w}x{h}"
                );
            }
        }
    }
}

#[test]
fn pos_inverts_idx() {
    let shape = shape(7, 5);
    for p in interior(shape) {
        let at = shape.idx(p).expect("an interior position has an index");
        assert_eq!(shape.pos(at.cell()), p);
    }
}

#[test]
fn chebyshev_is_the_longer_axis_from_either_end() {
    let (a, b) = (Pos { x: 1, y: 6 }, Pos { x: 4, y: 5 });
    assert_eq!((a.chebyshev(b), b.chebyshev(a)), (3, 3));
    let (low, high) = (Pos { x: i16::MIN, y: 0 }, Pos { x: i16::MAX, y: 0 });
    assert_eq!(low.chebyshev(high), u16::MAX);
}

#[test]
fn shape_bounds() {
    assert_eq!(Shape::new(2, 5), None);
    assert!(Shape::new(3, 3).is_some());
    assert!(Shape::new(32767, 3).is_some());
    assert_eq!(Shape::new(32768, 3), None);
}

#[test]
fn dir_all_is_row_major() {
    let keys = Dir::ALL.map(|dir| {
        let (dx, dy) = dir.offset();
        (dy, dx)
    });
    assert!(keys.windows(2).all(|pair| pair[0] < pair[1]), "{keys:?}");
}
