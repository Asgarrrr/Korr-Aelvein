use korr_core::mechanic::{Component, ImageError, Reader};
use korr_hunger::Diet;

#[test]
fn a_diet_reads_back_its_foods() {
    assert_eq!(Diet::read(&mut Reader::new(&[3])), Ok(Diet::ALL));
}

#[test]
fn a_diet_with_an_unknown_food_is_corrupt() {
    assert_eq!(
        Diet::read(&mut Reader::new(&[4])),
        Err(ImageError::Corrupt("diet"))
    );
}

#[test]
fn a_diet_with_a_known_and_an_unknown_food_is_corrupt() {
    // Plants, and an unknown food.
    assert_eq!(
        Diet::read(&mut Reader::new(&[5])),
        Err(ImageError::Corrupt("diet"))
    );
}
