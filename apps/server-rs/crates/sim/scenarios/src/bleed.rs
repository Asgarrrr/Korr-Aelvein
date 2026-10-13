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
            wound: ::korr_core::mechanic::Own<$crate::Wound>,
            clot: ::korr_core::mechanic::Own<$crate::Clot>,
        }

        impl $module {
            fn build(b: &mut ::korr_core::mechanic::Builder<'_>) -> Self {
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
                &::korr_core::mechanic::Own<$crate::Wound>,
                &::korr_core::mechanic::Own<$crate::Clot>,
            ) {
                (&self.wound, &self.clot)
            }
        }

        impl ::korr_core::mechanic::Module for $module {
            const NAME: &'static str = $name;
            type Action = ::core::convert::Infallible;
            type Plan = ::core::convert::Infallible;

            fn tick_rows(&self, rows: &mut ::korr_core::mechanic::Rows<'_>) {
                rows.join(&self.wound, &self.clot, |_, _| $amount);
            }

            fn propose(
                &self,
                _: &::korr_core::mechanic::Senses<'_>,
                _: &mut ::korr_core::mechanic::Proposals<'_, ::core::convert::Infallible>,
            ) {
            }

            fn prepare(
                &self,
                action: ::core::convert::Infallible,
                _: ::korr_core::mechanic::Target,
                _: &::korr_core::mechanic::PrepCtx<'_>,
            ) -> ::korr_core::mechanic::Prepared<
                ::core::convert::Infallible,
                ::core::convert::Infallible,
            > {
                match action {}
            }

            fn commit(
                &self,
                plan: ::core::convert::Infallible,
                _: &mut ::korr_core::mechanic::CommitCtx<'_>,
            ) {
                match plan {}
            }
        }
    };
}
