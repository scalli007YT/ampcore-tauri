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

// Radius scale, at double the original values. Still tighter than Mantine's
// stock scale — this is a control/monitoring tool, not a consumer app — but
// no longer near-square.
//
// These feed the `--mantine-radius-*` CSS vars, so they move more than the
// components that take a `radius` prop: the channel-strip tiles
// (`StatReadout`/`StatToggle`/`StatEditorTile`), `PresetActionTile`, and the
// `bdrs="sm"` containers all read `var(--mantine-radius-sm)` directly and
// follow this scale too.
export const theme = createTheme({
  primaryColor: "amber",
  primaryShade: { light: 6, dark: 5 },

  defaultRadius: "xs",
  radius: {
    xs: "4px",
    sm: "6px",
    md: "8px",
    lg: "12px",
    xl: "16px",
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
    // Modal's close button is a separate component from ActionIcon, so it
    // didn't inherit the "sm" downsize above.
    CloseButton: { defaultProps: { size: "sm" } },
    // Mantine's Modal.Title defaults to regular-weight md text — visually
    // indistinguishable from body copy at our dense font scale. Bump it so
    // dialog titles read as titles, the way they do in most other UI kits.
    //
    // The header also carries a hardcoded `min-height: 3.75rem` (60px) in
    // Mantine's own stylesheet, unrelated to title/button size — verified
    // via computed styles in a real browser. That's what actually produces
    // the oversized gap under every modal title; zero it out so the header
    // hugs its content instead.
    Modal: {
      // padding = breathing room inside the modal (header/body); yOffset/
      // xOffset = the margin between the modal box and the viewport edges.
      // Both default tighter than felt right at this density, independent
      // of the header-height fix above.
      defaultProps: {
        padding: "lg",
        yOffset: "8dvh",
        xOffset: "8vw",
      },
      styles: {
        title: { fontWeight: 600, fontSize: "var(--mantine-font-size-lg)" },
        header: { minHeight: 0 },
      },
    },
  },
});
