//! Hosting the simulation: the thread pool that runs the floors of a round.

use core::num::NonZeroUsize;

use korr_core::host::{Floor, Runner};
use rayon::iter::{IndexedParallelIterator, IntoParallelRefMutIterator, ParallelIterator};
use rayon::{ThreadPool, ThreadPoolBuildError, ThreadPoolBuilder};

/// Runs phase 1 with each floor as its own stealable job on an owned pool, never rayon's global one.
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
    fn each<F: Fn(&mut Floor) + Sync + Send>(&self, floors: &mut [Floor], f: F) {
        self.pool.install(|| {
            floors
                .par_iter_mut()
                .with_max_len(1)
                .panic_fuse()
                .for_each(f);
        });
    }
}
