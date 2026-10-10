use std::panic::{AssertUnwindSafe, catch_unwind};

use korr_core::{
    ActionDesc, Band, Candidate, Candidates, CommitCtx, Dir, Floor, LoadError, Mechanics, Pos,
    PrepCtx, Prepared, Ruleset, Seed, Senses, TICKS_PER_ROUND, Target, Tick, World,
};
use korr_ecs::{EntityId, FloorId, Handle, ImageError, SchemaBuilder, checksum};
use korr_scenarios::{Act, Answer, Leave, Scripted, floor};

const SEED: Seed = Seed(5);
const A: FloorId = FloorId(0);
const B: FloorId = FloorId(1);
const C: FloorId = FloorId(2);
const FREE: Pos = Pos { x: 3, y: 3 };
const TO_C: Leave = Leave {
    to: C,
    at: Pos { x: 2, y: 2 },
};

static HOME: ActionDesc = ActionDesc::new("keyed", "home");
static STEP: ActionDesc = ActionDesc::new("keyed", "step");

/// `rest` for every actor, except that `actor` runs `leave` from tick `from`.
#[derive(Debug)]
struct Keyed<M> {
    actor: EntityId,
    from: Tick,
    leave: Leave,
    rest: M,
}

impl<M: Mechanics> Mechanics for Keyed<M> {
    fn actions(&self, out: &mut Vec<&'static ActionDesc>) {
        out.push(&HOME);
        self.rest.actions(out);
    }

    fn perceives(&self) -> bool {
        self.rest.perceives()
    }

    fn propose(&self, senses: &Senses<'_>, out: &mut Candidates) {
        out.push(Candidate {
            action: &HOME,
            band: Band::Vigilance,
            weight: 0,
            target: Target::None,
        });
        self.rest.propose(senses, out);
    }

    fn prepare(&self, action: &'static ActionDesc, target: Target, ctx: &PrepCtx<'_>) -> Prepared {
        if action.key() != HOME.key() {
            self.rest.prepare(action, target, ctx)
        } else if ctx.actor() == self.actor && ctx.now() >= self.from {
            self.leave.prepare(action, target, ctx)
        } else {
            Prepared::Fail
        }
    }

    fn commit(&self, action: &'static ActionDesc, target: Target, ctx: &mut CommitCtx<'_>) {
        if action.key() == HOME.key() {
            self.leave.commit(action, target, ctx);
        } else {
            self.rest.commit(action, target, ctx);
        }
    }
}

fn ruleset(mechanics: &impl Mechanics) -> Ruleset {
    Ruleset::new(SchemaBuilder::default(), mechanics)
}

fn run(world: &mut World, ruleset: &Ruleset, mechanics: &impl Mechanics, rounds: u64) {
    for _ in 0..rounds {
        world.run_round(ruleset, mechanics);
    }
}

fn reload(ruleset: &Ruleset, world: &World) -> Vec<Floor> {
    world
        .floors()
        .iter()
        .map(|f| Floor::load(ruleset, &f.save(ruleset)).expect("own save loads"))
        .collect()
}

/// Whether a copy of `floor` can still take a new actor at `at`.
fn has_room(ruleset: &Ruleset, floor: &Floor, at: Pos) -> bool {
    let mut copy = Floor::load(ruleset, &floor.save(ruleset)).expect("own save loads");
    catch_unwind(AssertUnwindSafe(|| copy.spawn_actor(ruleset, at))).is_ok()
}

/// A and B hold 3 actors each; C holds 8 and one free cell. Returns C's actors.
fn build(ruleset: &Ruleset, reversed: bool) -> (World, Vec<Handle>) {
    let mut a = floor(ruleset, A.0, 7, 7);
    let mut b = floor(ruleset, B.0, 7, 7);
    for x in 1..=3 {
        a.spawn_actor(ruleset, Pos { x, y: 1 });
        b.spawn_actor(ruleset, Pos { x, y: 1 });
    }
    let mut c = floor(ruleset, C.0, 5, 5);
    let natives = (1..=3)
        .flat_map(|y| (1..=3).map(move |x| Pos { x, y }))
        .filter(|&p| p != FREE)
        .map(|p| c.spawn_actor(ruleset, p))
        .collect();
    let mut floors = vec![a, b, c];
    if reversed {
        floors.reverse();
    }
    (World::new(SEED, floors), natives)
}

#[test]
fn floor_order_never_changes_arrivals() {
    let ruleset = ruleset(&TO_C);
    let hashes = [false, true].map(|reversed| {
        let (mut world, natives) = build(&ruleset, reversed);
        run(&mut world, &ruleset, &TO_C, 3);
        let c = world.floor(C);
        assert!(natives.iter().all(|&h| c.pos(h).is_some_and(|p| p != FREE)));
        // C has 9 interior cells: the natives hold 8, one arrival holds FREE.
        assert!(!has_room(&ruleset, c, FREE));
        // Every barrier retries the inbox: it stays at 5 only while C is full.
        assert_eq!(c.inbox_len(), 5);
        world.hash(&ruleset)
    });
    assert_eq!(hashes[0], hashes[1]);
}

#[test]
fn save_with_travellers_waiting_replays() {
    let mechanics = Keyed {
        actor: EntityId::new(C, 0),
        from: Tick(2 * TICKS_PER_ROUND),
        leave: Leave {
            to: A,
            at: Pos { x: 3, y: 3 },
        },
        rest: TO_C,
    };
    let ruleset = ruleset(&mechanics);
    let (mut direct, _) = build(&ruleset, false);
    run(&mut direct, &ruleset, &mechanics, 3);

    let (mut world, _) = build(&ruleset, false);
    run(&mut world, &ruleset, &mechanics, 1);
    let mut world = World::new(SEED, reload(&ruleset, &world));
    assert_eq!(world.floor(C).inbox_len(), 5);
    run(&mut world, &ruleset, &mechanics, 2);
    assert_eq!(world.floor(C).inbox_len(), 4);
    assert_eq!(world.hash(&ruleset), direct.hash(&ruleset));
}

#[test]
fn equal_ticks_break_on_entity_id_not_slot() {
    let mechanics = Keyed {
        actor: EntityId::new(A, 0),
        from: Tick(0),
        leave: Leave {
            to: B,
            at: Pos { x: 1, y: 1 },
        },
        rest: Scripted(vec![Act {
            desc: &STEP,
            band: Band::Routine,
            weight: 0,
            target: Target::None,
            answer: Answer::Go(Dir::East),
        }]),
    };
    let ruleset = ruleset(&mechanics);
    let mut a = floor(&ruleset, A.0, 9, 5);
    let leaver = a.spawn_actor(&ruleset, Pos { x: 1, y: 1 });
    let older = a.spawn_actor(&ruleset, Pos { x: 1, y: 2 });
    let mut world = World::new(SEED, vec![a, floor(&ruleset, B.0, 5, 5)]);
    run(&mut world, &ruleset, &mechanics, 1);
    assert_eq!(world.floor(A).pos(older), Some(Pos { x: 2, y: 2 }));

    let mut floors = reload(&ruleset, &world);
    let newer = floors[0].spawn_actor(&ruleset, Pos { x: 3, y: 2 });
    assert_eq!(newer.slot(), leaver.slot());
    let mut world = World::new(SEED, floors);
    run(&mut world, &ruleset, &mechanics, 1);
    // Both step east at the same tick: older first finds (3,2) still held by newer.
    let a = world.floor(A);
    assert_eq!(a.pos(older), Some(Pos { x: 2, y: 2 }));
    assert_eq!(a.pos(newer), Some(Pos { x: 4, y: 2 }));
}

#[test]
fn a_flight_with_a_live_id_is_corrupt() {
    let ruleset = ruleset(&TO_C);
    let (mut world, _) = build(&ruleset, false);
    run(&mut world, &ruleset, &TO_C, 1);
    let mut bytes = world.floor(C).save(&ruleset);

    // Waiting flight A1 (id 1) is rewritten to id 0, the A actor that landed on C.
    // A flight is the round (0), the cell, then the traveller id.
    let store_end = 20 + u32::from_le_bytes(bytes[16..20].try_into().expect("4 bytes")) as usize;
    let mut forged_at = None;
    for at in store_end + 12..bytes.len() - 8 {
        if bytes[at - 12..at - 4] == [0; 8] && bytes[at..at + 8] == 1u64.to_le_bytes() {
            forged_at = Some(at);
        }
    }
    let at = forged_at.expect("flight A1 is waiting in the inbox");
    bytes[at..at + 8].copy_from_slice(&0u64.to_le_bytes());
    let body = bytes.len() - 8;
    let sum = checksum(&bytes[..body]);
    bytes[body..].copy_from_slice(&sum.to_le_bytes());

    assert_eq!(
        Floor::load(&ruleset, &bytes).err(),
        Some(LoadError::Image(ImageError::Corrupt("inbox duplicate id")))
    );
}

/// The byte range of each flight in the inbox of a saved floor: a round, a
/// cell, then a traveller, all of one length.
fn flight_ranges(bytes: &[u8], count: usize) -> Vec<std::ops::Range<usize>> {
    let body = bytes.len() - 8;
    let count_le = u32::try_from(count).expect("fits u32").to_le_bytes();
    let size = (24..body)
        .find(|size| {
            let at = body - count * size - 4;
            bytes[at..at + 4] == count_le
                && u32::from_le_bytes(bytes[at + 24..at + 28].try_into().expect("4 bytes"))
                    == u32::try_from(size - 24).expect("fits u32")
        })
        .expect("the inbox ends the image");
    let first = body - count * size;
    (0..count)
        .map(|i| first + i * size..first + (i + 1) * size)
        .collect()
}

fn reseal(bytes: &mut [u8]) {
    let body = bytes.len() - 8;
    let sum = checksum(&bytes[..body]);
    bytes[body..].copy_from_slice(&sum.to_le_bytes());
}

/// C after one round: 5 flights wait, all sent in round 0, ids ascending.
fn saved_inbox() -> (Ruleset, Vec<u8>, Vec<std::ops::Range<usize>>) {
    let ruleset = ruleset(&TO_C);
    let (mut world, _) = build(&ruleset, false);
    run(&mut world, &ruleset, &TO_C, 1);
    let bytes = world.floor(C).save(&ruleset);
    let flights = flight_ranges(&bytes, 5);
    (ruleset, bytes, flights)
}

#[test]
fn flights_out_of_order_are_corrupt() {
    let (ruleset, mut bytes, flights) = saved_inbox();
    let (first, second) = (flights[0].clone(), flights[1].clone());
    let swapped = [
        bytes[second.clone()].to_vec(),
        bytes[first.clone()].to_vec(),
    ]
    .concat();
    bytes[first.start..second.end].copy_from_slice(&swapped);
    reseal(&mut bytes);
    assert_eq!(
        Floor::load(&ruleset, &bytes).err(),
        Some(LoadError::Image(ImageError::Corrupt("inbox order")))
    );
}

#[test]
fn a_flight_repeated_is_corrupt() {
    let (ruleset, mut bytes, flights) = saved_inbox();
    let first = bytes[flights[0].clone()].to_vec();
    bytes[flights[1].clone()].copy_from_slice(&first);
    reseal(&mut bytes);
    assert_eq!(
        Floor::load(&ruleset, &bytes).err(),
        Some(LoadError::Image(ImageError::Corrupt("inbox order")))
    );
}

#[test]
fn a_flight_sent_in_the_current_round_is_corrupt() {
    let (ruleset, mut bytes, flights) = saved_inbox();
    let last = flights[4].start;
    bytes[last..last + 8].copy_from_slice(&1u64.to_le_bytes());
    reseal(&mut bytes);
    assert_eq!(
        Floor::load(&ruleset, &bytes).err(),
        Some(LoadError::Image(ImageError::Corrupt("inbox round")))
    );
}

#[test]
fn an_id_waiting_twice_is_corrupt() {
    let (ruleset, mut bytes, flights) = saved_inbox();
    bytes[..8].copy_from_slice(&2u64.to_le_bytes());
    let id = bytes[flights[0].start + 12..flights[0].start + 20].to_vec();
    let last = flights[4].start;
    bytes[last..last + 8].copy_from_slice(&1u64.to_le_bytes());
    bytes[last + 12..last + 20].copy_from_slice(&id);
    reseal(&mut bytes);
    assert_eq!(
        Floor::load(&ruleset, &bytes).err(),
        Some(LoadError::Image(ImageError::Corrupt("inbox duplicate id")))
    );
}
