import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Game from "./Game";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

createRoot(rootEl).render(
  <StrictMode>
    <Game />
  </StrictMode>,
);
