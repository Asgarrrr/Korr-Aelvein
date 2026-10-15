use korr_core::mechanic::{Component, ImageError, Module, Own, Reader, Writer};

#[derive(Debug)]
pub struct Wound;

impl Component for Wound {
    const VERSION: u16 = 0;

    fn write(&self, _: &mut Writer) {}

    fn read(_: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self)
    }
}

#[derive(Debug)]
pub struct Clot;

impl Component for Clot {
    const VERSION: u16 = 0;

    fn write(&self, _: &mut Writer) {}

    fn read(_: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self)
    }
}

/// A module declared by `bleed!`.
pub trait Bleeds: Module {
    fn keys(&self) -> (&Own<Wound>, &Own<Clot>);
}

/// Declares `$module`, named `$name`: its tick harms every holder of its
/// wound and clot by `$amount`.
#[macro_export]
macro_rules! bleed {
    ($module:ident, $name:literal, $amount:literal) => {
        struct $module {
            wound: $crate::__core::mechanic::Own<$crate::Wound>,
            clot: $crate::__core::mechanic::Own<$crate::Clot>,
        }

        impl $module {
            fn build(b: &mut $crate::__core::mechanic::Builder<'_>) -> Self {
                Self {
                    wound: b.own("wound"),
                    clot: b.own("clot"),
                }
            }
        }

        impl $crate::Bleeds for $module {
            fn keys(
                &self,
            ) -> (
                &$crate::__core::mechanic::Own<$crate::Wound>,
                &$crate::__core::mechanic::Own<$crate::Clot>,
            ) {
                (&self.wound, &self.clot)
            }
        }

        impl $crate::__core::mechanic::Module for $module {
            const NAME: &'static str = $name;
            type Action = ::core::convert::Infallible;
            type Plan = ::core::convert::Infallible;

            fn tick_rows(&self, rows: &mut $crate::__core::mechanic::Rows<'_>) {
                rows.join(&self.wound, &self.clot, |_, _| {
                    ::core::num::NonZeroU16::new($amount)
                });
            }

            fn propose(
                &self,
                _: &$crate::__core::mechanic::Senses<'_>,
                _: &mut $crate::__core::mechanic::Proposals<'_, ::core::convert::Infallible>,
            ) {
            }

            fn prepare(
                &self,
                action: ::core::convert::Infallible,
                _: $crate::__core::mechanic::Target,
                _: &$crate::__core::mechanic::PrepCtx<'_>,
            ) -> $crate::__core::mechanic::Prepared<
                ::core::convert::Infallible,
                ::core::convert::Infallible,
            > {
                match action {}
            }

            fn commit(
                &self,
                plan: ::core::convert::Infallible,
                _: &mut $crate::__core::mechanic::CommitCtx<'_>,
            ) {
                match plan {}
            }
        }
    };
}
