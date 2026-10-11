use core::marker::PhantomData;

use korr_grid::Pos;
use korr_random::{ModuleKey, name_hash};

use crate::ctx::{CommitCtx, PrepCtx};
use crate::decision::{ActionRef, Band, Candidate, Candidates};
use crate::senses::Senses;
use crate::time::Cost;

pub trait Action: Copy + Eq + core::fmt::Debug + 'static {
    /// Permanent order: the fingerprint hashes the keys in this order.
    const ALL: &'static [Self];
    fn name(self) -> &'static str;
}

impl Action for core::convert::Infallible {
    const ALL: &'static [Self] = &[];

    fn name(self) -> &'static str {
        match self {}
    }
}

/// One mechanic. `prepare` reads, draws and plans; `commit` applies the plan and cannot fail.
pub trait Module {
    const NAME: &'static str;
    type Action: Action;
    /// What `commit` needs: a commit cannot draw, so it cannot redo the plan differently.
    type Plan;
    /// Whether `propose` reads `Senses::seen`; when no module does, the core skips the scan.
    fn perceives(&self) -> bool {
        false
    }
    /// The components the actor must hold, by schema name; without one the run fails.
    #[must_use]
    fn requires(_: Self::Action) -> &'static [&'static str] {
        &[]
    }
    fn propose(&self, senses: &Senses<'_>, out: &mut Proposals<'_, Self::Action>);
    fn prepare(
        &self,
        action: Self::Action,
        target: Target,
        ctx: &PrepCtx<'_>,
    ) -> Prepared<Self::Action, Self::Plan>;
    fn commit(&self, plan: Self::Plan, ctx: &mut CommitCtx<'_>);
}

pub trait Visit {
    fn module<M: Module>(&mut self, module: &M);
}

/// Visits every enabled module in one fixed order.
pub trait Mechanics {
    fn each<V: Visit>(&self, v: &mut V);
}

impl<M: Module> Mechanics for M {
    fn each<V: Visit>(&self, v: &mut V) {
        v.module(self);
    }
}

/// # Panics
/// When `action` is missing from `A::ALL`.
pub(crate) fn index_of<A: Action>(action: A) -> usize {
    A::ALL
        .iter()
        .position(|&a| a == action)
        .unwrap_or_else(|| panic!("action missing from its module's ALL: {action:?}"))
}

/// A hash of `module/name`: the stable identity of an action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ActionKey(pub(crate) u64);

impl ActionKey {
    #[must_use]
    pub fn of<M: Module>(action: M::Action) -> Self {
        Self(name_hash(&[M::NAME, action.name()]))
    }

    #[must_use]
    pub const fn to_bits(self) -> u64 {
        self.0
    }
}

/// The stream of a module derives from its name alone: a module cannot pick another's.
pub(crate) fn module_key<M: Module>() -> ModuleKey {
    const { ModuleKey::of(M::NAME) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Target {
    None,
    Pos(Pos),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prepared<A, P> {
    Go { cost: Cost, plan: P },
    Instead { action: A, target: Target },
    Blocked,
    Fail,
}

/// Where one module's candidates go: each is tagged with the module and its action.
#[derive(Debug)]
pub struct Proposals<'a, A> {
    out: &'a mut Candidates,
    module: u16,
    keys: &'a [ActionKey],
    action: PhantomData<fn(A)>,
}

impl<'a, A> Proposals<'a, A> {
    pub(crate) fn new(out: &'a mut Candidates, module: u16, keys: &'a [ActionKey]) -> Self {
        Self {
            out,
            module,
            keys,
            action: PhantomData,
        }
    }
}

impl<A: Action> Proposals<'_, A> {
    /// # Panics
    /// When `action` is missing from `A::ALL`.
    pub fn push(&mut self, action: A, band: Band, weight: u16, target: Target) {
        let index = index_of(action);
        self.out.push(Candidate {
            action: ActionRef {
                module: self.module,
                index: u16::try_from(index).expect("a module's actions fit u16"),
                key: self.keys[index],
            },
            band,
            weight,
            target,
        });
    }
}
