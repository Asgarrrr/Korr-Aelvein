//! The registry: which mechanics run, in which order.
#![no_std]
#![deny(clippy::float_arithmetic)]

use korr_core::host::{Assembly, Declarations, Mechanics, Recipe, Visit};
use korr_flora::Flora;
use korr_hunger::Hunger;
use korr_wander::Wander;

/// `Registry`, one switch per mechanic, and `Modules`, the mechanics it
/// builds; the list order is the run order.
macro_rules! registry {
    ($($field:ident: $module:ty),+ $(,)?) => {
        /// Which mechanics run: all of them by default.
        #[derive(Debug, Clone, Copy)]
        pub struct Registry {
            $(pub $field: bool,)+
        }

        impl Default for Registry {
            fn default() -> Self {
                Self { $($field: true,)+ }
            }
        }

        /// The mechanics of a `Registry`: `None` for a disabled one.
        #[derive(Debug)]
        pub struct Modules {
            $(pub $field: Option<$module>,)+
        }

        impl Mechanics for Modules {
            fn each<V: Visit>(&self, v: &mut V) {
                $(if let Some(module) = &self.$field {
                    v.module(module);
                })+
            }
        }

        impl Recipe for Registry {
            type Mechanics = Modules;

            fn declare(&self, declarations: &mut Declarations) {
                $(if self.$field {
                    declarations.module::<$module>();
                })+
            }

            fn build(self, assembly: &mut Assembly<'_>) -> Modules {
                Modules {
                    $($field: self.$field.then(|| assembly.module(<$module>::build)),)+
                }
            }
        }
    };
}

registry! {
    wander: Wander,
    flora: Flora,
    hunger: Hunger,
}
