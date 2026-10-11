use korr_core::host::{Floor, Game, LoadError, Sections};
use korr_ecs::{ImageError, checksum};
use korr_scenarios::{Leave, game, run};

use super::{C, SEED, TO_C, build, homing};

fn parse(bytes: &[u8]) -> Sections {
    Sections::parse(bytes).expect("own save parses")
}

/// C after one round: 5 flights wait, all sent in round 0, ids ascending.
fn saved_inbox() -> (Game<Leave>, Vec<u8>) {
    let game = game(TO_C, SEED);
    let (mut world, _) = build(game.ruleset(), false);
    run(&game, &mut world, 1);
    let bytes = world.floor(C).save(game.ruleset());
    (game, bytes)
}

fn load_forged(edit: impl FnOnce(&mut Sections)) -> Option<LoadError> {
    let (game, bytes) = saved_inbox();
    let mut sections = parse(&bytes);
    assert_eq!(sections.flights.len(), 5);
    edit(&mut sections);
    Floor::load(game.ruleset(), &sections.seal()).err()
}

#[test]
fn sections_round_trip() {
    let (_, bytes) = saved_inbox();
    assert_eq!(parse(&bytes).seal(), bytes);
}

/// The image of C after one round, its checksum cut off.
fn saved_body() -> Vec<u8> {
    let (_, mut bytes) = saved_inbox();
    bytes.truncate(bytes.len() - size_of::<u64>());
    bytes
}

fn with_checksum(mut body: Vec<u8>) -> Vec<u8> {
    let sum = checksum(&body);
    body.extend_from_slice(&sum.to_le_bytes());
    body
}

#[test]
fn a_changed_byte_fails_the_checksum() {
    let mut body = saved_body();
    let sum = checksum(&body);
    body[0] ^= 1;
    body.extend_from_slice(&sum.to_le_bytes());
    assert_eq!(Sections::parse(&body), Err(ImageError::Checksum));
}

#[test]
fn a_cut_framing_is_truncated() {
    let mut body = saved_body();
    body.pop();
    assert!(matches!(
        Sections::parse(&with_checksum(body)),
        Err(ImageError::Truncated { .. })
    ));
}

#[test]
fn bytes_after_the_last_flight_are_trailing() {
    let mut body = saved_body();
    body.push(0);
    assert_eq!(
        Sections::parse(&with_checksum(body)),
        Err(ImageError::Trailing(1))
    );
}

#[test]
fn bytes_after_the_grid_are_trailing() {
    assert_eq!(
        load_forged(|s| s.grid.push(0)),
        Some(LoadError::Image(ImageError::Trailing(1)))
    );
}

#[test]
fn bytes_after_a_traveller_are_trailing() {
    assert_eq!(
        load_forged(|s| s.flights[0].traveller.push(0)),
        Some(LoadError::Image(ImageError::Trailing(1)))
    );
}

#[test]
fn flights_out_of_order_are_corrupt() {
    assert_eq!(
        load_forged(|s| s.flights.swap(0, 1)),
        Some(LoadError::Image(ImageError::Corrupt("inbox order")))
    );
}

#[test]
fn a_flight_repeated_is_corrupt() {
    assert_eq!(
        load_forged(|s| s.flights[1] = s.flights[0].clone()),
        Some(LoadError::Image(ImageError::Corrupt("inbox order")))
    );
}

#[test]
fn a_flight_sent_in_the_current_round_is_corrupt() {
    assert_eq!(
        load_forged(|s| s.flights[4].round = 1),
        Some(LoadError::Image(ImageError::Corrupt("inbox round")))
    );
}

#[test]
fn an_id_waiting_twice_is_corrupt() {
    let forged = load_forged(|s| {
        s.round = 2;
        let mut twin = s.flights[0].clone();
        twin.round = 1;
        s.flights.push(twin);
    });
    assert_eq!(
        forged,
        Some(LoadError::Image(ImageError::Corrupt("inbox duplicate id")))
    );
}

#[test]
fn a_flight_with_a_live_id_is_corrupt() {
    let game = homing();
    let (mut world, _) = build(game.ruleset(), false);
    run(&game, &mut world, 1);
    // The first waiting flight is A1, the lowest id sent in round 0.
    let a1 = parse(&world.floor(C).save(game.ruleset())).flights[0].clone();
    run(&game, &mut world, 2);
    // C0 left C in round 2, so A1 landed there.
    let mut later = parse(&world.floor(C).save(game.ruleset()));
    assert_eq!(later.flights.len(), 4);
    later.flights.insert(0, a1);
    assert_eq!(
        Floor::load(game.ruleset(), &later.seal()).err(),
        Some(LoadError::Image(ImageError::Corrupt("inbox duplicate id")))
    );
}
