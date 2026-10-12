use korr_core::mechanic::Cost;

/// Satiety lost per round.
pub const DECAY: u16 = 2;
/// Below this satiety a creature starts to need food.
pub const PECKISH: u16 = 300;
/// Below this satiety hunger outranks every routine.
pub const STARVING: u16 = 100;
/// Health lost per round on an empty stomach.
pub const STARVE_DAMAGE: u16 = 1;
/// The most a stomach holds.
pub const FULL: u16 = 1000;
/// Satiety gained per growth step of a grazed plant: one ripe plant sates.
pub const PLANT_NUTRITION: u16 = 50;
/// The most mass one meal takes from remains.
pub const BITE: u16 = 5;
/// Satiety gained per unit of remains mass eaten.
pub const REMAINS_NUTRITION: u16 = 20;
pub const EAT_COST: Cost = Cost::new(100);
pub const APPROACH_COST: Cost = Cost::new(100);
