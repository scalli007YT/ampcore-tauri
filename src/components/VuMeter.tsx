import { Text } from "@mantine/core";

/** A single scale position on a `VuMeter` — doubles as a plain tick label
 * (pass `label`) and/or a colored reference line drawn across the track
 * itself (pass `color`, e.g. a future clip-threshold marker). Both can be
 * combined, since they're really the same concept: "a position on the
 * scale, optionally labeled, optionally colored." */
export interface VuMeterMark {
  value: number;
  label?: string;
  color?: string;
}

export interface VuMeterProps {
  orientation: "horizontal" | "vertical";
  min: number;
  max: number;
  /** Current level, clamped to `[min, max]`. No live device value pipeline
   * exists yet in this offline-planning app, so every call site today
   * passes `min` (renders as fully unlit) — but the fill logic itself is
   * real, not a placeholder, so it's ready the moment live data arrives. */
  value: number;
  marks?: VuMeterMark[];
  /** Ordered color stops for an evenly-distributed gradient. Omit for a
   * flat `trackColor` fill instead. */
  gradient?: string[];
  trackColor?: string;
  /** Opacity of the always-visible backdrop (the "unlit shell"), separate
   * from the lit fill's opacity (always 1). Defaults to 1 for a flat
   * `trackColor` track; gradient callers typically pass something dimmer
   * (0.25–0.6) so the lit portion actually reads as "lit" once live data
   * arrives. */
  backdropOpacity?: number;
  /** Bar thickness in px — height if horizontal, width if vertical. */
  thickness?: number;
  /** Main-axis length — width if horizontal (default fills the wrapping
   * container, matching every current usage), height if vertical (default
   * 220, matching the Limiter panel's existing slider height). */
  size?: number | string;
  /** Dims and desaturates the whole meter — same convention as every other
   * disabled control in this app (e.g. `ThresholdSliderColumn` in
   * `LimiterEditor.tsx`, the bridged-follower row wrapper in
   * `AmpConfigureView.tsx`). Use for a muted channel, a bypassed stage, or
   * any other "this reading doesn't currently apply" state. */
  disabled?: boolean;
}

function clampFraction(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Shared VU-style meter — replaces every ad-hoc meter previously duplicated
 * across `AmpConfigureView.tsx` (`MockInputMeter`, `MockLevelMeter`) and
 * `LimiterEditor.tsx` (`MeterColumn`). Renders a dim full-length "unlit"
 * backdrop plus a real full-opacity "lit" fill from `min` up to `value`
 * (classic VU/LED-meter look), with `marks` positioned by actual value
 * (not array index) so unevenly-spaced scales stay correct. Orientation
 * switches both the gradient direction and the fill/mark axis: horizontal
 * fills left→right for the Input/Output/Scheme/Routing row meters,
 * vertical fills bottom→top (max at the top, like a real meter) for the
 * Limiter panel's Out dB/Limit dB columns. */
export function VuMeter({
  orientation,
  min,
  max,
  value,
  marks = [],
  gradient,
  trackColor = "var(--mantine-color-dark-6)",
  backdropOpacity = 1,
  thickness = 8,
  size,
  disabled = false,
}: VuMeterProps) {
  const horizontal = orientation === "horizontal";
  const fraction = clampFraction(value, min, max);
  const background = gradient
    ? `linear-gradient(${horizontal ? "to right" : "to top"}, ${gradient.join(", ")})`
    : trackColor;
  const trackSize = size ?? (horizontal ? "100%" : 220);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: horizontal ? "column" : "row",
        gap: 4,
        alignItems: horizontal ? "stretch" : "center",
        opacity: disabled ? 0.4 : 1,
        filter: disabled ? "grayscale(1)" : undefined,
      }}
    >
      <div
        className="rounded-[var(--mantine-radius-sm)]"
        style={{
          position: "relative",
          width: horizontal ? trackSize : thickness,
          height: horizontal ? thickness : trackSize,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div style={{ position: "absolute", inset: 0, background, opacity: backdropOpacity }} />
        {fraction > 0 &&
          (horizontal ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${fraction * 100}%`,
                background: gradient ? background : trackColor,
                backgroundSize: gradient ? `${100 / fraction}% 100%` : undefined,
                backgroundPosition: "left",
              }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: `${fraction * 100}%`,
                background: gradient ? background : trackColor,
                backgroundSize: gradient ? `100% ${100 / fraction}%` : undefined,
                backgroundPosition: "bottom",
              }}
            />
          ))}
        {marks
          .filter((mark) => mark.color)
          .map((mark, i) => {
            const t = clampFraction(mark.value, min, max);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  background: mark.color,
                  ...(horizontal
                    ? { left: `${t * 100}%`, top: 0, bottom: 0, width: 1 }
                    : { bottom: `${t * 100}%`, left: 0, right: 0, height: 1 }),
                }}
              />
            );
          })}
      </div>
      {marks.length > 0 && (
        <div
          style={{
            position: "relative",
            width: horizontal ? trackSize : 20,
            height: horizontal ? 12 : trackSize,
            flexShrink: 0,
          }}
        >
          {marks.map((mark, i) => {
            const t = clampFraction(mark.value, min, max);
            return (
              <Text
                key={i}
                fz={horizontal ? 8 : 9}
                c={mark.color ?? "dimmed"}
                style={{
                  position: "absolute",
                  whiteSpace: "nowrap",
                  ...(horizontal
                    ? { left: `${t * 100}%`, transform: "translateX(-50%)" }
                    : { bottom: `${t * 100}%`, transform: "translateY(50%)", left: 0 }),
                }}
              >
                {mark.label}
              </Text>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The shared 5-stop green→amber→red gradient used by every level-style
 * meter (`MockLevelMeter`'s and the Limiter's "Out dB" gradient were
 * previously separate identical strings in two files). */
export const DEFAULT_LEVEL_GRADIENT = ["#0f6e5c 0%", "#2f9e6a 35%", "#d4c94a 65%", "#e0793a 82%", "#d64545 100%"];
