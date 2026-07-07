import { createTheme } from "@mantine/core";

// Deliberately tight radius scale — this is a control/monitoring tool, not
// a consumer app, so corners stay close to square rather than Mantine's
// default rounded look.
export const theme = createTheme({
  defaultRadius: "xs",
  radius: {
    xs: "3px",
    sm: "4px",
    md: "6px",
    lg: "8px",
    xl: "10px",
  },
});
