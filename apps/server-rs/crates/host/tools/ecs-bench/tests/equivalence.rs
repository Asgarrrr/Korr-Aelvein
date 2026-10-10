use korr_ecs_bench::bevy_world::BevyWorld;
use korr_ecs_bench::dense::Dense;
use korr_ecs_bench::hecs_world::HecsWorld;
use korr_ecs_bench::ours::Ours;
use korr_ecs_bench::{Backend, picks};

const N: u32 = 2_000;
const K: u32 = 500;

type Step = (&'static str, u64, u64);

fn trace<B: Backend>(seed: u64) -> Vec<Step> {
    let picks = picks(seed, N, K);
    let mut backend = B::populate(N);
    let mut steps = vec![("populate", 0, backend.checksum())];
    backend.churn(&picks);
    steps.push(("churn", 0, backend.checksum()));
    let sum = backend.actor_turn(&picks);
    steps.push(("actor_turn", sum, backend.checksum()));
    for _ in 0..3 {
        backend.bulk();
        steps.push(("bulk", 0, backend.checksum()));
    }
    for _ in 0..3 {
        backend.query();
        steps.push(("query", 0, backend.checksum()));
    }
    for _ in 0..2 {
        backend.travel(&picks);
        steps.push(("travel", 0, backend.checksum()));
    }
    steps
}

fn assert_matches<B: Backend>(seed: u64, expected: &[Step]) {
    for (index, (got, want)) in trace::<B>(seed).iter().zip(expected).enumerate() {
        assert_eq!(
            got,
            want,
            "seed {seed}, step {index} ({}), backend {} against ours",
            want.0,
            B::NAME
        );
    }
}

#[test]
fn every_backend_agrees_after_every_op() {
    for seed in 1..=3 {
        let expected = trace::<Ours>(seed);
        assert_matches::<HecsWorld>(seed, &expected);
        assert_matches::<BevyWorld>(seed, &expected);
        assert_matches::<Dense>(seed, &expected);
    }
}
