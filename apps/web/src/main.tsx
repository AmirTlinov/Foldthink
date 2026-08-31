import { createRoot } from "react-dom/client";
import { FoldthinkPage } from "./foldthink-page.js";
import "./app-theme.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Foldthink root element is missing.");
}

createRoot(root).render(<FoldthinkPage />);
