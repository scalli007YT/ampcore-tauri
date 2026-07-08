import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Muted amber accent — desaturated on purpose (professional audio-gear feel,
// not a bright "candy" orange). Used sparingly by design: most of the UI
// stays grayscale, this only shows up on primary actions/active states.
const amber: MantineColorsTuple = [
  "#fbf1e6",
  "#f3ddc0",
  "#e9c496",
  "#deaa6a",
  "#d69646",
  "#d18a30",
  "#b97724",
  "#9c631d",
  "#805017",
  "#663f10",
];

// Deliberately tight radius scale — this is a control/monitoring tool, not
// a consumer app, so corners stay close to square rather than Mantine's
// default rounded look.
export const theme = createTheme({
  primaryColor: "amber",
  primaryShade: { light: 6, dark: 5 },

  defaultRadius: "xs",
  radius: {
    xs: "3px",
    sm: "4px",
    md: "6px",
    lg: "8px",
    xl: "10px",
  },

  colors: {
    amber,
  },

  // Denser than Mantine's defaults — this is a dense management tool
  // (VSCode/Armonia Plus style), not a roomy consumer app.
  fontSizes: {
    xs: "11px",
    sm: "12px",
    md: "13px",
    lg: "15px",
    xl: "17px",
  },
  spacing: {
    xs: "6px",
    sm: "8px",
    md: "10px",
    lg: "14px",
    xl: "18px",
  },

  // Flatten shadows in favor of borders — heavy drop shadows read as
  // "consumer SaaS card", not "professional tool panel".
  shadows: {
    xs: "0 1px 2px rgba(0, 0, 0, 0.1)",
    sm: "0 1px 3px rgba(0, 0, 0, 0.12)",
    md: "0 2px 4px rgba(0, 0, 0, 0.14)",
    lg: "0 2px 6px rgba(0, 0, 0, 0.16)",
    xl: "0 4px 8px rgba(0, 0, 0, 0.18)",
  },

  components: {
    Button: { defaultProps: { size: "sm" } },
    TextInput: { defaultProps: { size: "sm" } },
    Textarea: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm" } },
    ActionIcon: { defaultProps: { size: "sm" } },
  },
});
