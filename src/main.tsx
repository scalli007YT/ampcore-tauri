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
      <Notifications position="bottom-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
