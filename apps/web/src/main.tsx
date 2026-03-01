import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";
import "./components/stitch/stitch-theme.css";

// StrictMode removed: it double-mounts components in dev, which kills
// the ElevenLabs WebSocket session immediately after connect.
createRoot(document.getElementById("root")!).render(<App />);
