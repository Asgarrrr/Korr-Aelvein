import { treaty } from "@elysia/eden";
import { useEffect, useState } from "react";
import type { App } from "server";

const SERVER_URL = "http://localhost:3000";
const client = treaty<App>(SERVER_URL);

const KEY_DIR: Record<string, "n" | "e" | "s" | "w"> = {
  ArrowUp: "n",
  w: "n",
  ArrowRight: "e",
  d: "e",
  ArrowDown: "s",
  s: "s",
  ArrowLeft: "w",
  a: "w",
};

type Snapshot = {
  turn: number;
  gameOver: boolean;
  hp: { current: number; max: number };
  grid: string;
};

function Game() {
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    const game = client.game.subscribe();

    game.on("open", () => setStatus("open"));
    game.subscribe(({ data }) => {
      const { width, height, tiles } = data.level.grid;
      const { x: px, y: py } = data.player;
      const mobByCell = new Map<string, string>();
      for (const m of data.mobs) mobByCell.set(`${m.x},${m.y}`, m.glyph);
      const rows: string[] = [];
      for (let y = 0; y < height; y++) {
        let row = "";
        for (let x = 0; x < width; x++) {
          if (x === px && y === py) {
            row += "@";
            continue;
          }
          const mob = mobByCell.get(`${x},${y}`);
          if (mob !== undefined) {
            row += mob;
            continue;
          }
          const t = tiles[y * width + x] ?? 0;
          row += t === 1 ? "." : t === 2 ? "+" : "#";
        }
        rows.push(row);
      }
      setSnapshot({
        turn: data.turn,
        gameOver: data.gameOver,
        hp: data.player.hp,
        grid: rows.join("\n"),
      });
    });
    game.on("close", () => setStatus("closed"));

    function handleKey(e: KeyboardEvent) {
      if (e.key === "." || e.key === " ") {
        e.preventDefault();
        game.send({ type: "WAIT" });
        return;
      }
      const dir = KEY_DIR[e.key];
      if (dir === undefined) return;
      e.preventDefault();
      game.send({ type: "MOVE", dir });
    }
    window.addEventListener("keydown", handleKey);

    return () => {
      game.close();
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Korr Aelvein</h1>
      <p>Status: {status}</p>
      {snapshot !== null && (
        <p>
          Turn {snapshot.turn} — HP {snapshot.hp.current} / {snapshot.hp.max}
          {snapshot.gameOver && " — GAME OVER"}
        </p>
      )}
      <pre style={{ fontSize: 11, maxHeight: 600, overflow: "auto" }}>
        {snapshot?.grid ?? ""}
      </pre>
    </main>
  );
}

export default Game;
