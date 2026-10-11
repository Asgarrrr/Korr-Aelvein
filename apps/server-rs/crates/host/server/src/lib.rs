//! Hosting the simulation: the thread pool that runs the floors of a round.

use core::num::NonZeroUsize;

use korr_core::host::{Floor, Job, Runner};
use rayon::iter::{IndexedParallelIterator, IntoParallelIterator, ParallelIterator};
use rayon::{ThreadPool, ThreadPoolBuildError, ThreadPoolBuilder};

/// Runs phase 1 with each floor's job stealable on its own, on an owned pool, never rayon's global one.
/// A floor's panic reaches the caller with the world half-advanced: that world is lost, and the server reloads a save.
#[derive(Debug)]
pub struct Threads {
    pool: ThreadPool,
}

impl Threads {
    /// # Errors
    /// When the pool's threads cannot be spawned.
    pub fn new(threads: NonZeroUsize) -> Result<Self, ThreadPoolBuildError> {
        ThreadPoolBuilder::new()
            .num_threads(threads.get())
            .build()
            .map(|pool| Self { pool })
    }
}

impl Runner for Threads {
    fn each<F: Fn(&mut Floor) + Sync>(&self, jobs: Vec<Job<'_, F>>) {
        self.pool.install(|| {
            jobs.into_par_iter()
                .with_max_len(1)
                .panic_fuse()
                .for_each(Job::run);
        });
    }
}
