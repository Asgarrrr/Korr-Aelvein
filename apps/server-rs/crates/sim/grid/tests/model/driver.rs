use std::collections::VecDeque;
use std::num::NonZeroU32;
use std::panic::{AssertUnwindSafe, catch_unwind};

use korr_ecs::{
    ComponentKey, EntityId, FloorId, Handle, Reader, Schema, SchemaBuilder, Store, Traveller,
    Writer,
};
use korr_grid::{CellIdx, Dir, Grid, Interior, Layer, MAX_STEP, Material, Pos, Shape, StepError};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

use crate::reference::Reference;
use crate::spot::Spot;

const STALE_KEPT: usize = 256;
const OP_SUBJECT: Subject = Subject::Entity(0);

struct Floor {
    store: Store,
    grid: Grid,
}

#[derive(Clone, Copy)]
struct Placed {
    floor: usize,
    h: Handle,
    id: EntityId,
    cell: CellIdx,
    layer: Layer,
}

/// A departed entity, off every floor until its destination has a place.
struct InFlight {
    floor: usize,
    target: Pos,
    layer: Layer,
    traveller: Traveller,
}

/// Floors of `Grid`s driven by seeded operations next to a `Reference`.
pub(crate) struct World {
    seed: u64,
    step: u64,
    schema: Schema,
    spot: ComponentKey<Spot>,
    floors: Vec<Floor>,
    reference: Reference,
    alive: Vec<Placed>,
    stale: Vec<(usize, Handle)>,
    inbox: VecDeque<InFlight>,
}

impl World {
    pub(crate) fn new(seed: u64, shapes: &[(u16, u16)]) -> Self {
        let mut builder = SchemaBuilder::default();
        let spot = builder.register("spot");
        let schema = builder.build();
        let mut reference = Reference::default();
        let floors = shapes
            .iter()
            .enumerate()
            .map(|(floor, &(width, height))| {
                let shape = Shape::new(width, height).expect("the model shape fits the bounds");
                let mut grid = Grid::new(shape);
                let stream = stream(seed, Phase::Spawn, u64::try_from(floor).expect("fits u64"));
                for y in 1..height - 1 {
                    for x in 1..width - 1 {
                        let subject = Subject::Cell(u64::from(y) * u64::from(width) + u64::from(x));
                        let at = shape
                            .idx(pos(x, y))
                            .expect("the loop stays inside the ring");
                        let walkable = stream.below(subject, DrawIndex(0), bound(8)) != 0;
                        let height = i8::try_from(stream.below(subject, DrawIndex(1), bound(5)))
                            .expect("below 5 fits i8")
                            - 2;
                        let material = if walkable {
                            Material::GROUND
                        } else {
                            Material::WALL
                        };
                        grid.set_material(at, material);
                        grid.set_height(at, height);
                        reference.set_terrain((floor, at.cell()), walkable, height);
                    }
                }
                let id = FloorId(u16::try_from(floor).expect("a model floor fits u16"));
                Floor {
                    store: Store::new(&schema, id),
                    grid,
                }
            })
            .collect();
        Self {
            seed,
            step: 0,
            schema,
            spot,
            floors,
            reference,
            alive: Vec::new(),
            stale: Vec::new(),
            inbox: VecDeque::new(),
        }
    }

    pub(crate) fn run(&mut self, steps: u64) {
        for _ in 0..steps {
            self.step();
        }
    }

    fn step(&mut self) {
        let stream = stream(self.seed, Phase::Action, self.step);
        self.step += 1;
        let draw = |len: usize| {
            let len = NonZeroU32::new(u32::try_from(len).expect("fits u32"))?;
            Some(stream.below(OP_SUBJECT, DrawIndex(1), len) as usize)
        };
        let op = stream.below(OP_SUBJECT, DrawIndex(0), bound(100));
        if op < 30 {
            self.spawn(stream);
        } else if op < 45 {
            if let Some(index) = draw(self.alive.len()) {
                self.despawn(index);
            }
        } else if op < 52 {
            if let Some(index) = draw(self.alive.len()) {
                self.depart(index, stream);
            }
        } else if op < 60 {
            self.arrive();
        } else {
            let actors: Vec<usize> = self
                .alive
                .iter()
                .enumerate()
                .filter(|(_, p)| p.layer == Layer::Actor)
                .map(|(i, _)| i)
                .collect();
            if let Some(index) = draw(actors.len()) {
                let dir = Dir::ALL[stream.below(OP_SUBJECT, DrawIndex(2), bound(8)) as usize];
                self.move_actor(actors[index], dir);
            }
        }
    }

    fn spawn(&mut self, stream: Stream) {
        let below = |n, len: u32| stream.below(OP_SUBJECT, DrawIndex(n), bound(len));
        let floor = below(1, self.floor_count()) as usize;
        let shape = self.floors[floor].grid.shape();
        let draw = |n, side: u16| {
            u16::try_from(below(n, u32::from(side - 2))).expect("below a u16 side fits u16") + 1
        };
        let at = shape
            .idx(pos(draw(2, shape.width()), draw(3, shape.height())))
            .expect("the draw stays inside the ring");
        let layer = if below(4, 3) == 0 {
            Layer::Thing
        } else {
            Layer::Actor
        };
        if !self.reference.can_place((floor, at.cell()), layer) {
            return;
        }
        let Floor { store, grid } = &mut self.floors[floor];
        let h = store.spawn();
        let pos = shape.pos(at.cell());
        store.insert(self.spot, h, Spot { pos, layer });
        link(grid, store, h, at, layer);
        self.placed(floor, h, at, layer);
    }

    fn floor_count(&self) -> u32 {
        u32::try_from(self.floors.len()).expect("fits u32")
    }

    fn placed(&mut self, floor: usize, h: Handle, at: Interior, layer: Layer) {
        let id = self.floors[floor]
            .store
            .id(h)
            .expect("a placed handle is alive");
        let cell = at.cell();
        self.reference.place((floor, cell), layer, id);
        self.alive.push(Placed {
            floor,
            h,
            id,
            cell,
            layer,
        });
    }

    /// Unlinks before the store frees the slot, then keeps the handle as a stale probe.
    fn take(&mut self, index: usize) -> Placed {
        let p = self.alive.swap_remove(index);
        self.floors[p.floor].grid.unlink(p.h);
        self.reference.remove((p.floor, p.cell), p.layer, p.id);
        if self.stale.len() == STALE_KEPT {
            self.stale.remove(0);
        }
        self.stale.push((p.floor, p.h));
        p
    }

    fn despawn(&mut self, index: usize) {
        let p = self.take(index);
        self.floors[p.floor].store.despawn(p.h);
    }

    /// The target is drawn two cells past every side, so arrival clamps it.
    fn depart(&mut self, index: usize, stream: Stream) {
        let below = |n, len: u32| stream.below(OP_SUBJECT, DrawIndex(n), bound(len));
        let floor = below(2, self.floor_count()) as usize;
        let shape = self.floors[floor].grid.shape();
        let draw = |n, side: u16| {
            i16::try_from(below(n, u32::from(side) + 4)).expect("below a model side fits i16") - 2
        };
        let target = Pos {
            x: draw(3, shape.width()),
            y: draw(4, shape.height()),
        };
        let p = self.take(index);
        let traveller = self.floors[p.floor].store.detach(p.h);
        self.inbox.push_back(InFlight {
            floor,
            target,
            layer: p.layer,
            traveller,
        });
    }

    /// A refused arrival goes to the back of the inbox: it stays queued.
    fn arrive(&mut self) {
        let Some(flight) = self.inbox.pop_front() else {
            return;
        };
        let step = self.step;
        let floor = flight.floor;
        let Floor { store, grid } = &mut self.floors[floor];
        let shape = grid.shape();
        let found = grid.nearest_place(flight.target, flight.layer);
        assert_eq!(
            found.map(Interior::cell),
            self.reference
                .nearest(floor, shape, flight.target, flight.layer),
            "step {step}: arrival at {:?} on floor {floor}",
            flight.target
        );
        let Some(at) = found else {
            self.inbox.push_back(flight);
            return;
        };
        let h = store
            .attach(flight.traveller)
            .expect("a detached row attaches");
        store
            .get_mut(self.spot, h)
            .expect("a traveller keeps its spot")
            .pos = shape.pos(at.cell());
        link(grid, store, h, at, flight.layer);
        self.placed(floor, h, at, flight.layer);
    }

    fn move_actor(&mut self, index: usize, dir: Dir) {
        let step = self.step;
        let Placed { floor, h, id, .. } = self.alive[index];
        let from = self.alive[index].cell;
        let Floor { store, grid } = &mut self.floors[floor];
        let shape = grid.shape();
        let (dx, dy) = dir.offset();
        let Pos { x, y } = shape.pos(from);
        let to = Pos {
            x: x + dx,
            y: y + dy,
        };
        let terrain = |cell| self.reference.terrain((floor, cell));
        let expected = match shape.idx(to).map(|at| (at.cell(), terrain(at.cell()))) {
            None | Some((_, (false, _))) => Err(StepError::Blocked),
            Some((_, (_, height))) if terrain(from).1.abs_diff(height) > MAX_STEP => {
                Err(StepError::TooSteep)
            }
            Some((cell, _)) if self.reference.actor((floor, cell)).is_some() => {
                Err(StepError::Occupied)
            }
            Some((cell, _)) => Ok(cell),
        };
        assert_eq!(
            grid.step(h, dir),
            expected.map(|_| to),
            "step {step}: {to:?}"
        );
        if let Ok(cell) = expected {
            self.reference.remove((floor, from), Layer::Actor, id);
            self.reference.place((floor, cell), Layer::Actor, id);
            self.alive[index].cell = cell;
            store
                .get_mut(self.spot, h)
                .expect("a placed entity has a spot")
                .pos = to;
        }
    }

    /// Handles survive `Store::load`, so `alive` and `stale` stay valid.
    pub(crate) fn reload(&mut self) {
        for Floor { store, grid } in &mut self.floors {
            *store = Store::load(&self.schema, &store.save()).expect("own image reloads");
            let mut w = Writer::new();
            grid.write(&mut w);
            let bytes = w.into_bytes();
            let mut reader = Reader::new(&bytes);
            *grid = Grid::read(
                &mut reader,
                store,
                store
                    .iter(self.spot)
                    .map(|(h, spot)| (h, spot.pos, spot.layer)),
            )
            .expect("own grid rebuilds");
            reader.finish().expect("the grid reads every byte it wrote");
        }
    }

    /// A stale handle must be refused even when a newer entity holds its slot;
    /// the cell comparison below then proves the refusal wrote nothing.
    pub(crate) fn check(&mut self) {
        let step = self.step;
        for &(floor, h) in &self.stale {
            let grid = &mut self.floors[floor].grid;
            assert!(
                catch_unwind(AssertUnwindSafe(|| grid.unlink(h))).is_err(),
                "step {step}: stale unlink accepted"
            );
            assert!(
                catch_unwind(AssertUnwindSafe(|| grid.step(h, Dir::East))).is_err(),
                "step {step}: stale step accepted"
            );
        }
        for (floor, Floor { store, grid }) in self.floors.iter().enumerate() {
            let id = |h| store.id(h).expect("a linked handle is alive");
            let mut linked = 0;
            for cell in self.reference.cells(floor) {
                let at = grid.shape().pos(cell);
                let found = grid.actor_at(cell).map(id);
                assert_eq!(
                    found,
                    self.reference.actor((floor, cell)),
                    "step {step}: actor at {at:?} on floor {floor}"
                );
                let things: Vec<EntityId> = grid.things(cell).map(id).collect();
                assert_eq!(
                    things,
                    self.reference.things((floor, cell)),
                    "step {step}: things at {at:?} on floor {floor}"
                );
                linked += usize::from(found.is_some()) + things.len();
            }
            let alive = self.alive.iter().filter(|p| p.floor == floor).count();
            assert_eq!(linked, alive, "step {step}: linked count on floor {floor}");
        }
    }
}

fn link(grid: &mut Grid, store: &Store, h: Handle, at: Interior, layer: Layer) {
    match layer {
        Layer::Actor => grid.link_actor(store, h, at),
        Layer::Thing => grid.link_thing(store, h, at),
    }
}

fn stream(seed: u64, phase: Phase, time: u64) -> Stream {
    Stream::new(Seed(seed), ModuleKey::of("grid-model"), phase, time)
}

fn pos(x: u16, y: u16) -> Pos {
    let coord = |v: u16| i16::try_from(v).expect("a model side fits i16");
    Pos {
        x: coord(x),
        y: coord(y),
    }
}

fn bound(n: u32) -> NonZeroU32 {
    NonZeroU32::new(n).expect("bound is not zero")
}
