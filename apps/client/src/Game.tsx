import { treaty } from "@elysia/eden";
import { useEffect, useState } from "react";
import type { App } from "server";
import { renderGrid } from "./render";

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
  activeZone: number;
  zones: number[];
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
    // Latest snapshot pulled into a ref so the keydown handler can read the
    // current zone graph without re-binding on every snapshot tick.
    let latest: Snapshot | null = null;

    game.on("open", () => setStatus("open"));
    game.subscribe(({ data }) => {
      const grid = renderGrid({
        width: data.level.grid.width,
        height: data.level.grid.height,
        tiles: data.level.grid.tiles,
        player: { x: data.player.x, y: data.player.y },
        mobs: data.mobs,
      });
      const next: Snapshot = {
        turn: data.turn,
        gameOver: data.gameOver,
        activeZone: data.activeZone,
        zones: data.zones,
        hp: data.player.hp,
        grid,
      };
      latest = next;
      setSnapshot(next);
    });
    game.on("close", () => setStatus("closed"));

    function handleKey(e: KeyboardEvent) {
      if (e.key === "." || e.key === " ") {
        e.preventDefault();
        game.send({ type: "WAIT" });
        return;
      }
      if (e.key === ">") {
        e.preventDefault();
        if (latest === null) return;
        const next = latest.zones.find((z) => z !== latest?.activeZone);
        if (next === undefined) return;
        game.send({ type: "ENTER_ZONE", zone: next });
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
          Turn {snapshot.turn} — HP {snapshot.hp.current} / {snapshot.hp.max} —
          Zone {snapshot.activeZone}
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
