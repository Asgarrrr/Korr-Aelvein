//! Entity storage: stable ids, generational handles and one store per floor.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod codec;
mod column;
mod entities;
mod error;
mod id;
mod image;
mod join;
mod schema;
mod store;
mod travel;

pub use codec::{Component, Reader, Writer, checksum};
pub use error::ImageError;
pub use id::{EntityId, FloorId, Handle};
pub use schema::{ComponentKey, Schema, SchemaBuilder};
pub use store::Store;
pub use travel::Traveller;
