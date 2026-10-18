/// The largest legal |Δh| of a step.
pub const MAX_STEP: u8 = 1;

pub(crate) struct MaterialProps {
    pub(crate) walkable: bool,
}

/// Indexed by material id.
pub(crate) const MATERIALS: [MaterialProps; 2] = [
    MaterialProps { walkable: false },
    MaterialProps { walkable: true },
];

// The ring is material 0: walkable implies interior.
const _: () = assert!(!MATERIALS[0].walkable);
