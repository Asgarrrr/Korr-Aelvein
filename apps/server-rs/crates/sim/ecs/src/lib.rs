//! Entity storage: stable ids, generational handles and one store per floor.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod column;
mod entities;
mod id;
mod schema;
mod store;

pub use id::{EntityId, FloorId, Handle};
pub use schema::{ComponentKey, Schema, SchemaBuilder};
pub use store::Store;
