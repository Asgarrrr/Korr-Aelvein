//! Flora: the plants on the cells of a floor.
#![no_std]
#![deny(clippy::float_arithmetic)]

use core::convert::Infallible;

use korr_core::mechanic::{CommitCtx, Module, PrepCtx, Prepared, Proposals, Senses, Target};

#[derive(Debug, Default, Clone, Copy)]
pub struct Flora;

impl Module for Flora {
    const NAME: &'static str = "flora";
    type Action = Infallible;
    type Plan = Infallible;

    fn propose(&self, _: &Senses<'_>, _: &mut Proposals<'_, Infallible>) {}

    fn prepare(
        &self,
        action: Infallible,
        _: Target,
        _: &PrepCtx<'_>,
    ) -> Prepared<Infallible, Infallible> {
        match action {}
    }

    fn commit(&self, plan: Infallible, _: &mut CommitCtx<'_>) {
        match plan {}
    }
}
