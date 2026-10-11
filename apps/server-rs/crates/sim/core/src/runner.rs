use crate::floor::Floor;

/// Runs phase 1 of a round on every floor. Floors share no mutable state
/// there, so any order or split gives the same result.
pub trait Runner {
    fn each<F: Fn(&mut Floor) + Sync + Send>(&self, floors: &mut [Floor], f: F);
}

#[derive(Debug)]
pub struct Sequential;

impl Runner for Sequential {
    fn each<F: Fn(&mut Floor) + Sync + Send>(&self, floors: &mut [Floor], f: F) {
        floors.iter_mut().for_each(f);
    }
}
