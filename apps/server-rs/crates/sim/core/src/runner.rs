use alloc::vec::Vec;
use core::fmt;

use crate::floor::Floor;

/// Runs phase 1 of a round: each job at most once, in any order or split.
/// A dropped job skips its floor's phase 1.
pub trait Runner {
    fn each<F: Fn(&mut Floor) + Sync>(&self, jobs: Vec<Job<'_, F>>);
}

/// One floor's phase 1. Running it consumes it, and it exposes no floor.
///
/// ```
/// # use korr_core::host::{Floor, Job, Runner};
/// struct Backwards;
///
/// impl Runner for Backwards {
///     fn each<F: Fn(&mut Floor) + Sync>(&self, jobs: Vec<Job<'_, F>>) {
///         jobs.into_iter().rev().for_each(Job::run);
///     }
/// }
/// ```
///
/// ```compile_fail
/// # use korr_core::host::{Floor, Job, Runner};
/// struct Twice;
///
/// impl Runner for Twice {
///     fn each<F: Fn(&mut Floor) + Sync>(&self, jobs: Vec<Job<'_, F>>) {
///         for mut job in jobs {
///             job.run();
///             job.run();
///         }
///     }
/// }
/// ```
///
/// ```compile_fail
/// # use korr_core::host::{Floor, Job, Runner};
/// struct Peek;
///
/// impl Runner for Peek {
///     fn each<F: Fn(&mut Floor) + Sync>(&self, jobs: Vec<Job<'_, F>>) {
///         for mut job in jobs {
///             let _ = job.floor().id();
///         }
///     }
/// }
/// ```
pub struct Job<'a, F> {
    floor: &'a mut Floor,
    work: &'a F,
}

impl<F: Fn(&mut Floor)> Job<'_, F> {
    pub fn run(self) {
        (self.work)(self.floor);
    }
}

impl<F> fmt::Debug for Job<'_, F> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Job").finish_non_exhaustive()
    }
}

pub(crate) fn jobs<'a, F>(floors: &'a mut [Floor], work: &'a F) -> Vec<Job<'a, F>> {
    floors.iter_mut().map(|floor| Job { floor, work }).collect()
}

#[derive(Debug)]
pub struct Sequential;

impl Runner for Sequential {
    fn each<F: Fn(&mut Floor) + Sync>(&self, jobs: Vec<Job<'_, F>>) {
        jobs.into_iter().for_each(Job::run);
    }
}
