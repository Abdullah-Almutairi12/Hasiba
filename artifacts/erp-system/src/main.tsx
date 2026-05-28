import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { initSentry } from "./lib/sentry";

initSentry();

createRoot(document.getElementById("root")!).render(<App />);
