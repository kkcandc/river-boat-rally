import "./style.css";
import { Game } from "./game";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");

try {
  new Game(root);
} catch (error) {
  const message = error instanceof Error ? error.message : "This browser could not start the race.";
  root.innerHTML = `<div class="fail"><h1>River Energy</h1><p>${message}</p></div>`;
}
