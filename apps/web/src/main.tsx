import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app";
import "./app/app.css";
import { WorldClient } from "./transport/world-client";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Application root is missing");

const client = new WorldClient();
createRoot(rootElement).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
