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

function Game() {
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [snapshot, setSnapshot] = useState<string | null>(null);

  useEffect(() => {
    const game = client.game.subscribe();

    game.on("open", () => setStatus("open"));
    game.subscribe(({ data }) => {
      setSnapshot(JSON.stringify(data, null, 2));
    });
    game.on("close", () => setStatus("closed"));

    function handleKey(e: KeyboardEvent) {
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
      <pre style={{ fontSize: 11, maxHeight: 600, overflow: "auto" }}>
        {snapshot}
      </pre>
    </main>
  );
}

export default Game;
