use korr_core::host::{EVENTS_PER_ROUND, Event, Pos, Seed, Vitality, World, keyed};
use korr_ecs::FloorId;
use korr_engine::Registry;
use korr_hunger::Diet;
use korr_scenarios::{Bleeds, Clot, Wound, bleed, floor, game, hunger, plants, run, stomach};

const FIELD: FloorId = FloorId(0);
const SEED: Seed = Seed(1);
const ROUNDS: u64 = 50;
const SIDE: u16 = 16;
const CREATURES: u32 = 24;
const HP: u16 = 12;

/// The cells of the interior in row order, from the `k`-th.
fn cell(side: u16, k: u32) -> Pos {
    let inside = u32::from(side - 2);
    let coord = |v: u32| i16::try_from(v + 1).expect("an interior coordinate fits i16");
    Pos {
        x: coord(k % inside),
        y: coord(k / inside),
    }
}

/// The hash after `ROUNDS` rounds of a meadow where some creatures graze
/// and the rest starve, and how many died on the way.
fn meadow(events: bool) -> (u64, usize) {
    let game = game(Registry::default(), SEED);
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, FIELD, SIDE, SIDE);
    f.set_events(events);
    for k in 0..6 {
        f.set_cell(
            ruleset,
            plants(game.mechanics()),
            cell(SIDE, 30 * k + 7),
            u8::MAX,
        );
    }
    for k in 0..CREATURES {
        let h = f.spawn_actor(ruleset, cell(SIDE, 8 * k + 3));
        stomach(&mut f, hunger(game.mechanics()), h, 0, Diet::ALL);
        f.init(ruleset.vitality(), h, Vitality { hp: HP, max: 4 });
    }
    let mut world = World::new(vec![f]);
    let mut deaths = 0;
    for _ in 0..ROUNDS {
        run(&game, &mut world, 1);
        deaths += world
            .floor(FIELD)
            .events()
            .iter()
            .filter(|event| matches!(event, Event::Died { .. }))
            .count();
    }
    (game.hash(&world), deaths)
}

#[test]
fn the_hash_is_the_same_with_events_on_and_off() {
    let (on, deaths) = meadow(true);
    assert!(
        (1..CREATURES as usize).contains(&deaths),
        "some creatures starve and some graze: {deaths} deaths"
    );
    assert_eq!(meadow(false), (on, 0));
}

bleed!(Doom, "doom", 1);

/// A floor of things, each with one hit point and the wounds `Doom` joins.
/// One round kills them all, each leaving remains in a free cell.
fn doomed(victims: u32, events: bool) {
    let game = game(keyed(Doom::build), SEED);
    let ruleset = game.ruleset();
    let side = 100;
    let mut f = floor(ruleset, FIELD, side, side);
    f.set_events(events);
    let (wound, clot) = game.mechanics().keys();
    for k in 0..victims {
        let h = f.spawn_thing(cell(side, k));
        f.init(ruleset.vitality(), h, Vitality { hp: 1, max: 1 });
        f.insert(wound, h, Wound);
        f.insert(clot, h, Clot);
    }
    run(&game, &mut World::new(vec![f]), 1);
}

#[test]
fn a_round_of_exactly_the_cap_does_not_panic() {
    doomed(EVENTS_PER_ROUND / 2, true);
    doomed(EVENTS_PER_ROUND / 2, false);
}

#[test]
#[should_panic(expected = "events in one round")]
fn a_round_past_the_cap_panics_with_events_on() {
    doomed(EVENTS_PER_ROUND / 2 + 1, true);
}

#[test]
#[should_panic(expected = "events in one round")]
fn a_round_past_the_cap_panics_with_events_off() {
    doomed(EVENTS_PER_ROUND / 2 + 1, false);
}
