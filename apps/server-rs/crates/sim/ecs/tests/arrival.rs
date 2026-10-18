use korr_ecs::{Component, FloorId, ImageError, Reader, SchemaBuilder, Store, Traveller, Writer};

#[derive(Debug, PartialEq, Eq)]
struct Satiety(u32);

impl Component for Satiety {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u32(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u32().map(Self)
    }
}

/// Bytes 8..12 hold the row length, 12..20 the row's schema fingerprint.
fn reread(t: &Traveller, edit: impl FnOnce(&mut Vec<u8>)) -> Traveller {
    let mut w = Writer::new();
    t.write(&mut w);
    let mut bytes = w.into_bytes();
    edit(&mut bytes);
    Traveller::read(&mut Reader::new(&bytes)).expect("an edited traveller still reads")
}

#[test]
fn check_arrival_agrees_with_attach() {
    let mut builder = SchemaBuilder::default();
    let satiety = builder.register::<Satiety>("satiety");
    let schema = builder.build();
    let mut source = Store::new(&schema, FloorId(0));
    let mut destination = Store::new(&schema, FloorId(1));
    destination.spawn();
    let mut leave = || {
        let h = source.spawn();
        source.insert(&satiety, h, Satiety(7));
        source.detach(h)
    };
    let valid = leave();
    let truncated = reread(&leave(), |bytes| {
        bytes.pop();
        let row = u32::try_from(bytes.len() - 12).expect("a short row");
        bytes[8..12].copy_from_slice(&row.to_le_bytes());
    });
    let foreign = reread(&leave(), |bytes| bytes[12] ^= 1);
    let foreign_high = reread(&leave(), |bytes| bytes[19] ^= 1);

    for (t, expected) in [
        (truncated, ImageError::Truncated { at: 9 }),
        (
            foreign,
            ImageError::Fingerprint {
                saved: schema.fingerprint() ^ 1,
                running: schema.fingerprint(),
            },
        ),
        (
            foreign_high,
            ImageError::Fingerprint {
                saved: schema.fingerprint() ^ (1 << 56),
                running: schema.fingerprint(),
            },
        ),
    ] {
        let before = destination.save();
        assert_eq!(destination.check_arrival(&t), Err(expected.clone()));
        assert_eq!(destination.attach(t).err(), Some(expected));
        assert_eq!(destination.len(), 1);
        assert_eq!(destination.save(), before);
    }

    assert_eq!(destination.check_arrival(&valid), Ok(()));
    let h = destination
        .attach(valid)
        .expect("a checked traveller attaches");
    assert_eq!(destination.get(satiety.read(), h), Some(&Satiety(7)));
}

#[test]
fn a_traveller_id_with_bit_63_set_is_corrupt() {
    let mut w = Writer::new();
    w.write_u64(1 << 63);
    w.write_u32(0);
    let bytes = w.into_bytes();
    assert_eq!(
        Traveller::read(&mut Reader::new(&bytes)).err(),
        Some(ImageError::Corrupt("entity id"))
    );
}

#[test]
fn attaching_an_id_already_alive_here_is_refused() {
    let schema = SchemaBuilder::default().build();
    let mut source = Store::new(&schema, FloorId(0));
    let mut destination = Store::new(&schema, FloorId(1));
    let h = source.spawn();
    let t = source.detach(h);
    let copy = reread(&t, |_| {});
    destination.attach(t).expect("first attach");
    let alive = destination.len();
    let refusal = Err(ImageError::Corrupt("duplicate entity id"));
    assert_eq!(destination.check_arrival(&copy), refusal);
    assert_eq!(destination.attach(copy).map(|_| ()), refusal);
    assert_eq!(destination.len(), alive);
}
