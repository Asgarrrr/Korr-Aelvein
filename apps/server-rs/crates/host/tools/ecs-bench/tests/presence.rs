use korr_ecs_bench::picks;
use korr_ecs_bench::presence::{ALWAYS, Backend, COLUMNS, Dense, K, N, Ours};

fn assert_agree(ours: &Ours, dense: &Dense, step: &str) {
    for i in 0..N as usize {
        for column in 0..COLUMNS {
            assert_eq!(
                ours.value(i, column),
                dense.value(i, column),
                "{step}: entity {i}, column {column}"
            );
        }
    }
}

#[test]
fn sparse_and_dense_agree_after_every_op() {
    let picks = picks(1, N, K);
    let mut ours = Ours::populate();
    let mut dense = Dense::populate();
    assert_agree(&ours, &dense, "populate");
    ours.churn(&picks);
    dense.churn(&picks);
    assert_agree(&ours, &dense, "churn");
    let churned = u64::try_from(picks.len()).expect("few picks");
    assert_eq!((ours.despawned(), dense.despawned()), (churned, churned));
    assert_eq!(ours.actor_turn(&picks), dense.actor_turn(&picks));
    assert_agree(&ours, &dense, "actor_turn");
    for column in [1, ALWAYS] {
        ours.bulk(column);
        dense.bulk(column);
        assert_agree(&ours, &dense, "bulk");
    }
    assert_eq!(ours.query(), dense.query());
    assert_agree(&ours, &dense, "query");
}
