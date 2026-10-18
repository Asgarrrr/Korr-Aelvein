use korr_grid::{CellColumn, Pos, Shape};

#[test]
fn a_window_off_the_floor_holds_the_neighbourhood() {
    let shape = Shape::new(7, 5).expect("7x5 fits the bounds");
    let mut column = CellColumn::new(shape);
    for (value, at) in (1..).zip(shape.neighbourhood(Pos { x: 3, y: 2 }, u16::MAX)) {
        column.set(at, value);
    }
    for radius in [0, 1, 2] {
        for cy in -3..=8 {
            for cx in [i16::MIN, -6, -3, -2, 8, 9, 12, i16::MAX] {
                let centre = Pos { x: cx, y: cy };
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
                assert_eq!(window, around, "{centre:?} radius {radius}");
            }
        }
    }
}
