import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./council.css";

// Uncaught errors are recorded on <body> as well as logged. Some embedded browsers do
// not surface the console at all, and a silent failure in a 3D scene is indistinguishable
// from a slow asset.
window.addEventListener("error", (e) => {
  try {
    document.body.dataset.lastError =
      `${e.message} @ ${e.filename?.split("/").pop()}:${e.lineno}`;
  } catch { /* never let diagnostics break the app */ }
});
window.addEventListener("unhandledrejection", (e) => {
  try {
    document.body.dataset.lastRejection = String(
      (e.reason as Error)?.message ?? e.reason,
    ).slice(0, 300);
  } catch { /* ignore */ }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
