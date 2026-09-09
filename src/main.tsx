import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "./styles/tailwind.css";
import { theme } from "./theme";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      {/* `limit` is explicit because failure toasts now persist until
          dismissed (see `liveConfigureAdapter`'s `reportWrite`) — without a
          cap, a burst against an unreachable amp could bury the screen.
          `defaultColorScheme="auto"` below must stay in sync with the
          inlined ColorSchemeScript in index.html. */}
      <Notifications position="bottom-right" limit={5} />
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
