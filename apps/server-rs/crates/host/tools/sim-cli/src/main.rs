use std::io::{self, BufWriter, ErrorKind, Write};
use std::process::ExitCode;

use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

const MODULE: ModuleKey = ModuleKey::of("practrand");
const USAGE: &str = "usage: sim-cli rng <index|subject|cell|time|seed|turn>  (raw u64 LE on stdout, for PractRand stdin64)";

// Each field counts up while the others stay fixed: sequential inputs are
// the worst case for a counter-based mixer and the common case in a turn.
// `index` moves to the next subject every 2^32 draws.
#[derive(Debug, Clone, Copy)]
enum Field {
    Index,
    Subject,
    Cell,
    Time,
    Seed,
    Turn,
}

impl Field {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "index" => Self::Index,
            "subject" => Self::Subject,
            "cell" => Self::Cell,
            "time" => Self::Time,
            "seed" => Self::Seed,
            "turn" => Self::Turn,
            _ => return None,
        })
    }

    fn draw(self, k: u64) -> u64 {
        let fixed = Stream::new(Seed(1), MODULE, Phase::Tick, 0);
        match self {
            Self::Index => fixed.draw(Subject::Entity(k >> 32), low_index(k)),
            Self::Subject => fixed.draw(Subject::Entity(k), DrawIndex(0)),
            Self::Cell => fixed.draw(Subject::Cell(k), DrawIndex(0)),
            Self::Time => {
                Stream::new(Seed(1), MODULE, Phase::Tick, k).draw(Subject::Entity(0), DrawIndex(0))
            }
            Self::Seed => {
                Stream::new(Seed(k), MODULE, Phase::Tick, 0).draw(Subject::Entity(0), DrawIndex(0))
            }
            // 256 creatures drawing 4 times each per turn.
            Self::Turn => Stream::new(Seed(1), MODULE, Phase::Action, k >> 10)
                .draw(Subject::Entity((k >> 2) & 0xff), low_index(k & 3)),
        }
    }
}

fn low_index(k: u64) -> DrawIndex {
    DrawIndex(u32::try_from(k & 0xffff_ffff).expect("masked to 32 bits"))
}

fn emit(field: Field) -> io::Result<()> {
    let mut out = BufWriter::with_capacity(1 << 16, io::stdout().lock());
    for k in 0.. {
        out.write_all(&field.draw(k).to_le_bytes())?;
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let field = match args.as_slice() {
        [cmd, name] if cmd == "rng" => Field::parse(name),
        _ => None,
    };
    let Some(field) = field else {
        let _ = writeln!(io::stderr(), "{USAGE}");
        return ExitCode::from(2);
    };
    match emit(field) {
        // PractRand closes the pipe once it reaches its length limit.
        Err(e) if e.kind() != ErrorKind::BrokenPipe => {
            let _ = writeln!(io::stderr(), "sim-cli: {e}");
            ExitCode::FAILURE
        }
        _ => ExitCode::SUCCESS,
    }
}
