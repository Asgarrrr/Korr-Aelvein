import { treaty } from "@elysia/eden";
import { useEffect, useState } from "react";
import type { App } from "server";

const SERVER_URL = "http://localhost:3000";
const client = treaty<App>(SERVER_URL);

function Game() {
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  useEffect(() => {
    const game = client.game.subscribe();

    game.on("open", () => {
      setStatus("open");
      game.send({ type: "ping", at: Date.now() });
    });
    game.subscribe(({ data }) => {
      setLastMessage(JSON.stringify(data));
    });
    game.on("close", () => setStatus("closed"));

    return () => {
      game.close();
    };
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Korr Aelvein</h1>
      <p>WS status: {status}</p>
      <p>Last message: {lastMessage ?? "(none)"}</p>
    </main>
  );
}

export default Game;
