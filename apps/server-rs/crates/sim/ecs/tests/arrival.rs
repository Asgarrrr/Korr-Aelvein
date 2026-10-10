use korr_ecs::{Component, FloorId, ImageError, Reader, SchemaBuilder, Store, Traveller, Writer};

#[derive(Debug, PartialEq, Eq)]
struct Satiety(u32);

impl Component for Satiety {
    fn write(&self, w: &mut Writer) {
        w.write_u32(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u32().map(Self)
    }
}

/// Bytes 8..12 hold the row length, 12..16 the row's column count.
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
    let miscounted = reread(&leave(), |bytes| {
        bytes[12..16].copy_from_slice(&2u32.to_le_bytes());
    });

    for (t, expected) in [
        (truncated, ImageError::Truncated { at: 5 }),
        (miscounted, ImageError::Schema { index: 2 }),
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
