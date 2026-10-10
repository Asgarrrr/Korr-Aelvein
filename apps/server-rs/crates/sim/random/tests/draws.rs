use std::collections::BTreeSet;
use std::num::NonZeroU32;

use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

const KEYS: u32 = 1 << 12;
const SAMPLES: u32 = 1 << 18;

fn draw(seed: u64, module: &str, phase: Phase, time: u64, subject: Subject, n: u32) -> u64 {
    Stream::new(Seed(seed), ModuleKey::of(module), phase, time).draw(subject, DrawIndex(n))
}

fn tick(seed: u64, time: u64, subject: u32, n: u32) -> u64 {
    draw(
        seed,
        "hunger",
        Phase::Tick,
        time,
        Subject::Entity(subject),
        n,
    )
}

#[test]
fn every_field_changes_the_draw() {
    let base = draw(1, "hunger", Phase::Tick, 10, Subject::Entity(5), 3);
    let variants = [
        draw(2, "hunger", Phase::Tick, 10, Subject::Entity(5), 3),
        draw(1, "fear", Phase::Tick, 10, Subject::Entity(5), 3),
        draw(1, "Hunger", Phase::Tick, 10, Subject::Entity(5), 3),
        draw(1, "hunger", Phase::Action, 10, Subject::Entity(5), 3),
        draw(1, "hunger", Phase::Tick, 11, Subject::Entity(5), 3),
        draw(1, "hunger", Phase::Tick, 10, Subject::Entity(6), 3),
        draw(1, "hunger", Phase::Tick, 10, Subject::Cell(5), 3),
        draw(1, "hunger", Phase::Tick, 10, Subject::Entity(5), 4),
    ];
    for (i, variant) in variants.iter().enumerate() {
        assert_ne!(*variant, base, "variant {i} repeats the base draw");
    }
}

#[test]
fn subjects_and_indices_never_alias() {
    let mut seen = BTreeSet::new();
    for s in 0..64 {
        for n in 0..64 {
            for subject in [Subject::Entity(s), Subject::Cell(s)] {
                assert!(
                    seen.insert(draw(1, "hunger", Phase::Tick, 0, subject, n)),
                    "{subject:?} draw {n} repeats an earlier draw"
                );
            }
        }
    }
}

#[test]
#[should_panic(expected = "subject")]
fn a_subject_past_31_bits_is_refused() {
    let _ = tick(1, 0, 1 << 31, 0);
}

fn assert_avalanche(field: &str, width: u32, pair: impl Fn(u32, u32) -> (u64, u64)) {
    for bit in 0..width {
        let mut flips = [0_u32; 64];
        for k in 0..KEYS {
            let (a, b) = pair(k, bit);
            let diff = a ^ b;
            for (out, count) in flips.iter_mut().enumerate() {
                *count += u32::from((diff >> out) & 1 == 1);
            }
        }
        let total: u32 = flips.iter().sum();
        let mean = f64::from(total) / f64::from(64 * KEYS);
        assert!(
            (mean - 0.5).abs() < 0.01,
            "{field} bit {bit}: mean flip rate {mean}"
        );
        for (out, &count) in flips.iter().enumerate() {
            let rate = f64::from(count) / f64::from(KEYS);
            assert!(
                (rate - 0.5).abs() < 0.05,
                "{field} bit {bit} -> output bit {out}: flip rate {rate}"
            );
        }
    }
}

// Sequential keys are the realistic input: times, ids and indices count up.
#[test]
fn one_input_bit_flips_half_the_output() {
    assert_avalanche("seed", 64, |k, bit| {
        let seed = u64::from(k);
        (tick(seed, 0, 0, 0), tick(seed ^ (1 << bit), 0, 0, 0))
    });
    assert_avalanche("time", 64, |k, bit| {
        let time = u64::from(k);
        (tick(1, time, 0, 0), tick(1, time ^ (1 << bit), 0, 0))
    });
    assert_avalanche("subject", 31, |k, bit| {
        (tick(1, 0, k, 0), tick(1, 0, k ^ (1 << bit), 0))
    });
    assert_avalanche("index", 32, |k, bit| {
        (tick(1, 0, 0, k), tick(1, 0, 0, k ^ (1 << bit)))
    });
}

fn assert_uniform(case: &str, bound: u32, sample: impl Fn(u32) -> u32) {
    let size = usize::try_from(bound).expect("test bounds fit usize");
    let mut counts = vec![0_u32; size];
    for i in 0..SAMPLES {
        let value = sample(i);
        assert!(value < bound, "{case}: {value} is not below {bound}");
        counts[usize::try_from(value).expect("value is below bound")] += 1;
    }
    let expected = f64::from(SAMPLES) / f64::from(bound);
    let chi: f64 = counts
        .iter()
        .map(|&c| (f64::from(c) - expected).powi(2) / expected)
        .sum();
    let df = f64::from(bound - 1);
    let limit = df + 6.0 * (2.0 * df).sqrt();
    assert!(
        chi < limit,
        "{case} bound {bound}: chi-square {chi} over {limit}"
    );
}

#[test]
fn bounded_draws_are_uniform() {
    let stream = Stream::new(Seed(1), ModuleKey::of("hunger"), Phase::Tick, 0);
    for bound in [2, 7, 1000] {
        let b = NonZeroU32::new(bound).expect("test bounds are nonzero");
        assert_uniform("sequential subjects", bound, |i| {
            stream.below(Subject::Entity(i), DrawIndex(0), b)
        });
        assert_uniform("sequential indices", bound, |i| {
            stream.below(Subject::Cell(7), DrawIndex(i), b)
        });
        assert_uniform("sequential times", bound, |i| {
            Stream::new(Seed(1), ModuleKey::of("hunger"), Phase::Tick, u64::from(i)).below(
                Subject::Entity(7),
                DrawIndex(0),
                b,
            )
        });
    }
}

// Catches a mistyped constant or a platform difference the statistics miss.
#[test]
fn known_answers() {
    assert_eq!(tick(0, 0, 0, 0), 0x0e84_afbb_3143_386f);
    assert_eq!(tick(1, 10, 5, 3), 0x6c3d_42db_28f6_42b4);
    assert_eq!(
        draw(42, "fear", Phase::Action, 7, Subject::Cell(1023), 9),
        0x34ba_af07_df45_2930
    );
    let last = Subject::Entity((1 << 31) - 1);
    assert_eq!(
        draw(u64::MAX, "flora", Phase::Spawn, u64::MAX, last, u32::MAX),
        0x04e6_606c_8c6f_a1fe
    );
    let stream = Stream::new(Seed(1), ModuleKey::of("hunger"), Phase::Tick, 10);
    let below = |bound, n| {
        let bound = NonZeroU32::new(bound).expect("test bounds are nonzero");
        stream.below(Subject::Entity(5), DrawIndex(n), bound)
    };
    assert_eq!([below(7, 0), below(7, 1), below(7, 2)], [2, 3, 0]);
    assert_eq!(
        [below(1000, 0), below(1000, 1), below(1000, 2)],
        [362, 555, 77]
    );
}
