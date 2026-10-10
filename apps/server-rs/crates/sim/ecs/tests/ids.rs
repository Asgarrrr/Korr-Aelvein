use korr_ecs::{EntityId, FloorId};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

const COUNTER_LIMIT: u64 = 1 << 47;

#[test]
fn max_id_fits_random_subject() {
    let id = EntityId::new(FloorId(u16::MAX), COUNTER_LIMIT - 1);
    assert_eq!(id.to_bits(), (1 << 63) - 1);
    let stream = Stream::new(Seed(0), ModuleKey::of("ids"), Phase::Spawn, 0);
    let _draw = stream.draw(Subject::Entity(id.to_bits()), DrawIndex(0));
}

#[test]
fn origin_and_counter_round_trip() {
    for floor in [0, 1, u16::MAX] {
        for counter in [0, 1, COUNTER_LIMIT - 1] {
            let id = EntityId::new(FloorId(floor), counter);
            assert_eq!(id.origin(), FloorId(floor));
            assert_eq!(id.counter(), counter);
        }
    }
}

#[test]
#[should_panic(expected = "entity counter exhausted")]
fn counter_past_47_bits_panics() {
    let _id = EntityId::new(FloorId(0), COUNTER_LIMIT);
}
