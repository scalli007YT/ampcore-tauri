import { useEffect, useState } from "react";
import { Button, Divider, Group, NumberInput, Slider, Stack, Text } from "@mantine/core";
import {
  commands,
  type AmpAssignment,
  type AmpCapability_Serialize as AmpCapability,
  type Limiter,
  type Project,
} from "../lib/bindings";
import { DEFAULT_LEVEL_GRADIENT, VuMeter, type VuMeterMark } from "./VuMeter";

const EDITOR_MAX_WIDTH = 640;
const SLIDER_HEIGHT = 220;
/** Scale for the Out dB/Limit dB columns — no live device data exists yet
 * in this offline-planning phase, so both meters are always shown at their
 * minimum (fully unlit), matching the old `MeterColumn`'s decorative-only
 * rule. */
const LIMITER_METER_MARKS: VuMeterMark[] = [0, -8, -16, -24, -32, -40].map((value) => ({
  value,
  label: String(value),
}));

/** `AmpChannel.limiter` is typed optional in TS (specta marks any
 * `#[serde(default = ...)]` field optional) even though the backend's
 * default constructor always populates it. Mirrors `default_limiter` in
 * `src-tauri/src/data/project.rs` so the editor never has to handle a
 * missing struct. */
const FALLBACK_LIMITER: Limiter = {
  rms: { enabled: false, thresholdVrms: 100, attackMs: 5, releaseMultiplier: 4 },
  peak: { enabled: false, thresholdVp: 140, holdMs: 10, releaseMs: 50 },
};

/** RMS power into `ohms` from an RMS voltage threshold — `P = V^2 / R`. */
function rmsPowerWatts(vrms: number, ohms: number): number {
  return (vrms * vrms) / ohms;
}

/** Instantaneous peak power into `ohms` from a peak voltage threshold —
 * `P = Vp^2 / R` (not divided by 2: "peak power" is the power at the
 * waveform's peak voltage, not a time-averaged/RMS-equivalent figure — for a
 * sine wave this is exactly 2x the RMS power at the corresponding RMS
 * voltage, e.g. 60 Vrms / 84.85 Vpeak into 8 Ω is 450 W RMS / 900 W peak). */
function peakPowerWatts(vp: number, ohms: number): number {
  return (vp * vp) / ohms;
}

/** Inverse of both `rmsPowerWatts`/`peakPowerWatts` (both are `P = V^2 / R`,
 * so both invert the same way) — lets the Prms/Ppeak fields be edited
 * directly and back-solved to a voltage threshold, interchangeable with the
 * Threshold field rather than a read-only readout. */
function voltageForPowerWatts(watts: number, ohms: number): number {
  return Math.sqrt(Math.max(0, watts) * ohms);
}

/** The Peak threshold's floor: at least double the RMS threshold's *power*,
 * capped at `peakMax` so the floor itself never exceeds what the model/range
 * allows. Since power scales with voltage squared (`P = V^2 / R`), doubling
 * power only requires the peak voltage to be `√2×` the RMS voltage, not
 * `2×` — `Vp = Vrms·√2` gives `Vp^2/R = 2·Vrms^2/R`, i.e. exactly double
 * the power, at any `R` (the load cancels out of the ratio). Matches the
 * original reference software's actual behavior (e.g. 63.25 Vrms / 500 W ↔
 * 89.44 Vpeak / 1000 W — a √2 voltage ratio, 2x power ratio) — an earlier
 * version of this floor used a literal 2x *voltage* multiplier, which
 * produces 4x power, not 2x. Shared by `patch()`'s async enforcement and
 * the sliders'/fields' `min` props so dragging or typing can't dip below
 * the floor in the first place, rather than only correcting it after the
 * fact. */
function requiredPeakFloor(rmsVoltage: number, peakMax: number): number {
  return Math.min(rmsVoltage * PEAK_HEADROOM_FACTOR, peakMax);
}

/** Peak voltage capability assumed relative to an amp's rated RMS voltage —
 * used to auto-derive the Peak stage's max threshold from the same
 * per-model rating that caps the RMS stage, and shared by `requiredPeakFloor`
 * for the "Peak power must be at least double RMS power" floor (see its own
 * doc comment for why √2 — not 2 — is the correct voltage-domain factor for
 * a power-domain doubling). */
const PEAK_HEADROOM_FACTOR = Math.SQRT2;

/** Threshold sliders operate in the Watt domain (not Volts) so dragging
 * snaps to whole 10 W steps — a voltage-domain step would translate to
 * uneven, non-round Watt increments once squared through `P = V^2 / R`. */
const SLIDER_WATT_STEP = 10;

interface LimiterEditorProps {
  assignment: AmpAssignment;
  project: Project;
  channelIndex: number;
  capability: AmpCapability;
  onProjectUpdate: (project: Project) => void;
}

/** Output protection editor for one channel — independent RMS and Peak
 * limiter stages, ported from the old app's `limiter-panel.tsx`: vertical
 * threshold sliders flanking a pair of decorative level meters, a shared
 * Load (ohms) field, and an ON/OFF pill per stage above the numeric fields.
 * Both stages can be engaged simultaneously. Derived power readouts and the
 * meters are display-only, computed from the channel's existing `ohms`
 * field — never persisted, since no live device data exists in this
 * offline-planning phase. */
export function LimiterEditor({ assignment, project, channelIndex, capability, onProjectUpdate }: LimiterEditorProps) {
  const channel = assignment.channels.find((c) => c.channelIndex === channelIndex) ?? assignment.channels[0];
  const limiter = channel.limiter ?? FALLBACK_LIMITER;
  const ohms = channel.ohms ?? 8;
  const ranges = capability.paramRanges;

  async function patch(fields: {
    rmsEnabled?: boolean;
    rmsThresholdVrms?: number;
    rmsAttackMs?: number;
    rmsReleaseMultiplier?: number;
    peakEnabled?: boolean;
    peakThresholdVp?: number;
    peakHoldMs?: number;
    peakReleaseMs?: number;
  }) {
    // Peak threshold must always be at least double the RMS threshold's
    // *power* (a √2 voltage ratio — see `requiredPeakFloor`'s doc comment),
    // enforced centrally here so it holds regardless of which control
    // (slider, Threshold field, or the interchangeable Prms/Ppeak Wattage
    // fields) triggered the change. Editing RMS upward bumps Peak up to the
    // new floor if it's now too low; editing Peak below the current floor
    // clamps it back up to the floor instead of silently rejecting it.
    const effectiveRms = fields.rmsThresholdVrms ?? rmsThresholdVrms;
    const requiredPeak = requiredPeakFloor(effectiveRms, peakThresholdMax);
    const effectivePeak = Math.max(fields.peakThresholdVp ?? peakThresholdVp, requiredPeak);
    const peakNeedsUpdate = fields.peakThresholdVp !== undefined || effectivePeak !== peakThresholdVp;

    const result = await commands.projectsSetChannelLimiter(project.id, assignment.id, channelIndex, {
      rmsEnabled: fields.rmsEnabled ?? null,
      rmsThresholdVrms: fields.rmsThresholdVrms ?? null,
      rmsAttackMs: fields.rmsAttackMs ?? null,
      rmsReleaseMultiplier: fields.rmsReleaseMultiplier ?? null,
      peakEnabled: fields.peakEnabled ?? null,
      peakThresholdVp: peakNeedsUpdate ? effectivePeak : null,
      peakHoldMs: fields.peakHoldMs ?? null,
      peakReleaseMs: fields.peakReleaseMs ?? null,
    });
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  const rmsThresholdVrms = limiter.rms.thresholdVrms ?? 0;
  const peakThresholdVp = limiter.peak.thresholdVp ?? 0;
  const rmsRange = ranges.rmsLimiterThresholdVrms;
  const peakRange = ranges.peakLimiterThresholdVp;

  // The assigned model's actual rated RMS voltage (`capability.topology.ratedRmsVoltage`,
  // resolved per-model in `capability::cvr::rated_rms_voltage` — `None` for
  // models with no known electrical datasheet, e.g. user-defined) caps the
  // threshold sliders/fields automatically, tighter than the generic
  // cross-model `AmpParamRanges` bound when it's the smaller of the two.
  const ratedRmsVoltage = capability.topology.ratedRmsVoltage;
  const rmsThresholdMax =
    ratedRmsVoltage != null ? Math.min(rmsRange.max ?? ratedRmsVoltage, ratedRmsVoltage) : (rmsRange.max ?? 200);
  const peakThresholdMax =
    ratedRmsVoltage != null
      ? Math.min(peakRange.max ?? ratedRmsVoltage * PEAK_HEADROOM_FACTOR, ratedRmsVoltage * PEAK_HEADROOM_FACTOR)
      : (peakRange.max ?? 280);
  // Peak's own min (slider drag range and NumberInput `min`) is raised to
  // this floor dynamically, so it's physically impossible to drag/type
  // below double the RMS threshold rather than relying solely on
  // after-the-fact correction in `patch()`.
  const peakThresholdMin = Math.max(peakRange.min ?? 0, requiredPeakFloor(rmsThresholdVrms, peakThresholdMax));

  // Mono-bridging (fixed adjacent pairing: floor(channel/2), e.g. (0,1),
  // (2,3)…) — Output tab. `output_bridged` lives only on the pair's leader
  // (even-indexed) channel; ported from the old app's bridging, where a
  // bridged pair's displayed threshold voltage/power doubles
  // (`bridgeVoltageMultiplier`) and the Load uses only the leader's ohms.
  // The *raw* stored threshold never changes across a bridge toggle — only
  // this display/edit conversion layer does, so un-bridging always reveals
  // the same per-channel value that was there before.
  const pairLeaderIndex = channelIndex - (channelIndex % 2);
  const pairFollowerIndex = pairLeaderIndex + 1;
  const leaderChannel = assignment.channels.find((c) => c.channelIndex === pairLeaderIndex);
  const hasFollower = assignment.channels.some((c) => c.channelIndex === pairFollowerIndex);
  const isBridged = hasFollower && (leaderChannel?.outputBridged ?? false);
  const voltageMultiplier = isBridged ? 2 : 1;
  const effectiveOhms = isBridged ? (leaderChannel?.ohms ?? 8) : ohms;
  const partnerIndex = channelIndex === pairLeaderIndex ? pairFollowerIndex : pairLeaderIndex;
  const partnerLetter = String.fromCharCode(65 + partnerIndex);

  function toDisplay(raw: number) {
    return raw * voltageMultiplier;
  }
  function fromDisplay(display: number) {
    return display / voltageMultiplier;
  }

  const rmsThresholdVrmsDisplay = toDisplay(rmsThresholdVrms);
  const peakThresholdVpDisplay = toDisplay(peakThresholdVp);
  const rmsThresholdMaxDisplay = toDisplay(rmsThresholdMax);
  const peakThresholdMaxDisplay = toDisplay(peakThresholdMax);
  const peakThresholdMinDisplay = toDisplay(peakThresholdMin);
  const rmsRangeMinDisplay = rmsRange.min != null ? toDisplay(rmsRange.min) : null;
  const peakRangeMinDisplay = peakRange.min != null ? toDisplay(peakRange.min) : null;

  async function handleOhmsChange(value: number) {
    const targetChannelIndex = isBridged ? pairLeaderIndex : channelIndex;
    const result = await commands.projectsSetChannelOhms(project.id, assignment.id, targetChannelIndex, value);
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  return (
    <Stack gap="md" p="md" align="center" style={{ maxWidth: EDITOR_MAX_WIDTH, margin: "0 auto" }}>
      {isBridged && (
        <Text size="xs" fw={700} c="green" ta="center">
          Bridged with Out{partnerLetter} — showing combined values
        </Text>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, width: "100%" }}>
        <ThresholdSliderColumn
          label="RMS"
          value={rmsPowerWatts(rmsThresholdVrmsDisplay, effectiveOhms)}
          min={rmsRangeMinDisplay != null ? rmsPowerWatts(rmsRangeMinDisplay, effectiveOhms) : 0}
          max={rmsPowerWatts(rmsThresholdMaxDisplay, effectiveOhms)}
          step={SLIDER_WATT_STEP}
          disabled={!limiter.rms.enabled}
          onChangeEnd={(watts) => {
            const rawVoltage = fromDisplay(voltageForPowerWatts(watts, effectiveOhms));
            patch({ rmsThresholdVrms: Math.min(rawVoltage, rmsThresholdMax) });
          }}
        />
        <LimiterMeterColumn label="Out dB" gradient valueText="---" />
        <LimiterMeterColumn label="Limit dB" valueText="0.0 dB" />
        <ThresholdSliderColumn
          label="Peak"
          value={peakPowerWatts(peakThresholdVpDisplay, effectiveOhms)}
          min={peakRangeMinDisplay != null ? peakPowerWatts(peakRangeMinDisplay, effectiveOhms) : 0}
          max={peakPowerWatts(peakThresholdMaxDisplay, effectiveOhms)}
          floor={peakPowerWatts(peakThresholdMinDisplay, effectiveOhms)}
          step={SLIDER_WATT_STEP}
          disabled={!limiter.peak.enabled}
          onChangeEnd={(watts) => {
            const rawVoltage = fromDisplay(voltageForPowerWatts(watts, effectiveOhms));
            patch({ peakThresholdVp: Math.min(rawVoltage, peakThresholdMax) });
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, width: "100%", alignItems: "end" }}>
        <OnOffButton enabled={limiter.rms.enabled} onClick={() => patch({ rmsEnabled: !limiter.rms.enabled })} />
        <div style={{ gridColumn: "span 2" }}>
          <NumberInput
            size="sm"
            label="Load"
            suffix=" Ω"
            min={isBridged ? 4 : 0.5}
            step={0.5}
            value={effectiveOhms}
            onChange={(value) => typeof value === "number" && handleOhmsChange(value)}
          />
        </div>
        <OnOffButton enabled={limiter.peak.enabled} onClick={() => patch({ peakEnabled: !limiter.peak.enabled })} />
      </div>

      <Divider w="100%" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, width: "100%" }}>
        <Stack gap="xs">
          <LimiterFieldRow
            label="Threshold"
            unit="Vrms"
            value={rmsThresholdVrmsDisplay}
            min={rmsRangeMinDisplay ?? undefined}
            max={rmsThresholdMaxDisplay}
            disabled={!limiter.rms.enabled}
            onChange={(value) => patch({ rmsThresholdVrms: Math.min(fromDisplay(value), rmsThresholdMax) })}
          />
          <LimiterFieldRow
            label="Prms"
            unit="W"
            value={rmsPowerWatts(rmsThresholdVrmsDisplay, effectiveOhms)}
            min={rmsRangeMinDisplay != null ? rmsPowerWatts(rmsRangeMinDisplay, effectiveOhms) : undefined}
            max={rmsPowerWatts(rmsThresholdMaxDisplay, effectiveOhms)}
            disabled={!limiter.rms.enabled}
            integer
            onChange={(watts) => {
              const rawVoltage = fromDisplay(voltageForPowerWatts(watts, effectiveOhms));
              patch({ rmsThresholdVrms: Math.min(rawVoltage, rmsThresholdMax) });
            }}
          />
          <LimiterFieldRow
            label="Attack"
            unit="ms"
            value={limiter.rms.attackMs ?? 0}
            min={ranges.rmsLimiterAttackMs.min ?? undefined}
            max={ranges.rmsLimiterAttackMs.max ?? undefined}
            disabled={!limiter.rms.enabled}
            onChange={(value) => patch({ rmsAttackMs: value })}
          />
          <LimiterFieldRow
            label="Release"
            unit="xAtk"
            step={0.5}
            value={limiter.rms.releaseMultiplier ?? 0}
            min={ranges.rmsLimiterReleaseMultiplier.min ?? undefined}
            max={ranges.rmsLimiterReleaseMultiplier.max ?? undefined}
            disabled={!limiter.rms.enabled}
            onChange={(value) => patch({ rmsReleaseMultiplier: value })}
          />
        </Stack>
        <Stack gap="xs">
          <LimiterFieldRow
            label="Threshold"
            unit="Vpeak"
            value={peakThresholdVpDisplay}
            min={peakThresholdMinDisplay}
            max={peakThresholdMaxDisplay}
            disabled={!limiter.peak.enabled}
            onChange={(value) => patch({ peakThresholdVp: Math.min(fromDisplay(value), peakThresholdMax) })}
          />
          <LimiterFieldRow
            label="Ppeak"
            unit="W"
            value={peakPowerWatts(peakThresholdVpDisplay, effectiveOhms)}
            min={peakPowerWatts(peakThresholdMinDisplay, effectiveOhms)}
            max={peakPowerWatts(peakThresholdMaxDisplay, effectiveOhms)}
            disabled={!limiter.peak.enabled}
            integer
            onChange={(watts) => {
              const rawVoltage = fromDisplay(voltageForPowerWatts(watts, effectiveOhms));
              patch({ peakThresholdVp: Math.min(rawVoltage, peakThresholdMax) });
            }}
          />
          <LimiterFieldRow
            label="Hold"
            unit="ms"
            value={limiter.peak.holdMs ?? 0}
            min={ranges.peakLimiterHoldMs.min ?? undefined}
            max={ranges.peakLimiterHoldMs.max ?? undefined}
            disabled={!limiter.peak.enabled}
            onChange={(value) => patch({ peakHoldMs: value })}
          />
          <LimiterFieldRow
            label="Release"
            unit="ms"
            value={limiter.peak.releaseMs ?? 0}
            min={ranges.peakLimiterReleaseMs.min ?? undefined}
            max={ranges.peakLimiterReleaseMs.max ?? undefined}
            disabled={!limiter.peak.enabled}
            onChange={(value) => patch({ peakReleaseMs: value })}
          />
        </Stack>
      </div>
    </Stack>
  );
}

/** Vertical threshold slider — RMS/Peak columns either side of the meters.
 * Operates in Watts (see `SLIDER_WATT_STEP`), not Volts.
 *
 * `min`/`max` define the track's fixed scale (the hardware range) and must
 * stay constant — the Peak slider's floor (double the RMS threshold) moves
 * around as RMS changes, but feeding that into `min` directly rescales the
 * whole track, making the thumb jump to a different pixel position for the
 * same value every time RMS changes ("shouldn't change the scale"). Instead
 * `floor` (defaults to `min`) clamps only the live/committed *value*, so the
 * track's proportions never move and the thumb simply can't be dragged past
 * that point, sticking there instead of rescaling around it.
 *
 * Tracks the dragged position in local state and only commits to the
 * backend on release (`onChangeEnd`), not on every intermediate `onChange`
 * tick. Dragging fires `onChange` continuously — committing on every tick
 * fired a flood of concurrent `patch()` calls, each reading the RMS/Peak
 * floor-enforcement inputs from whatever render happened to be current when
 * that particular tick's closure was created. Since the backend round trip
 * is slower than the drag's tick rate, those calls landed out of order and
 * could stomp a just-applied Peak bump with a stale, smaller one — the
 * "sometimes doesn't pull peak up/down correctly" flakiness. Committing
 * once on release removes the flood entirely. */
function ThresholdSliderColumn({
  label,
  value,
  min,
  max,
  floor,
  step,
  disabled,
  onChangeEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  floor?: number;
  step: number;
  disabled?: boolean;
  onChangeEnd: (value: number) => void;
}) {
  const effectiveFloor = floor ?? min;
  const [dragValue, setDragValue] = useState(value);
  useEffect(() => {
    setDragValue(value);
  }, [value]);

  return (
    <Stack gap={8} align="center" style={{ opacity: disabled ? 0.45 : 1 }}>
      <Text size="sm" fw={700} c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Slider
        orientation="vertical"
        h={SLIDER_HEIGHT}
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(dragValue, effectiveFloor), max)}
        disabled={disabled}
        onChange={(v) => setDragValue(Math.max(v, effectiveFloor))}
        onChangeEnd={(v) => onChangeEnd(Math.max(v, effectiveFloor))}
        label={(v) => `${Math.round(v)} W`}
      />
    </Stack>
  );
}

/** `Out dB`/`Limit dB` columns — `Out dB` uses the shared level gradient,
 * `Limit dB` (gain reduction) is a plain flat track. Both always show
 * `value` at the scale's max (fully unlit/no reduction) since no live
 * device data exists in this offline-planning phase. */
function LimiterMeterColumn({ label, gradient, valueText }: { label: string; gradient?: boolean; valueText: string }) {
  return (
    <Stack gap={8} align="center">
      <Text size="sm" fw={700} c="dimmed" tt="uppercase">
        {label}
      </Text>
      <VuMeter
        orientation="vertical"
        min={-40}
        max={0}
        value={0}
        gradient={gradient ? DEFAULT_LEVEL_GRADIENT : undefined}
        backdropOpacity={gradient ? 0.25 : 1}
        thickness={22}
        size={SLIDER_HEIGHT}
        marks={LIMITER_METER_MARKS}
      />
      <Text size="xs" c="dimmed">
        {valueText}
      </Text>
    </Stack>
  );
}

/** Green/gray ON-OFF pill for a limiter stage — same halved-green tint as
 * `EqEditor`'s `ActiveStateButton` for visual consistency across the app,
 * with "ON"/"OFF" wording matching the reference layout for this panel. */
function OnOffButton({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return (
    <Button
      size="sm"
      fullWidth
      variant="default"
      onClick={onClick}
      styles={
        enabled
          ? {
              root: {
                backgroundColor: "color-mix(in srgb, var(--mantine-color-green-light) 50%, transparent)",
                color: "var(--mantine-color-green-6)",
                border: "1px solid color-mix(in srgb, var(--mantine-color-green-light) 50%, transparent)",
              },
            }
          : undefined
      }
    >
      {enabled ? "ON" : "OFF"}
    </Button>
  );
}

function LimiterFieldRow({
  label,
  unit,
  value,
  min,
  max,
  step,
  disabled,
  integer,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Restricts this field to whole numbers only — no decimal point can be
   * typed at all (not just rounded after the fact). Used for the Wattage
   * fields, which read as round Watt figures rather than the more precise
   * (and more naturally fractional) voltage thresholds. */
  integer?: boolean;
  onChange?: (value: number) => void;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" style={{ opacity: disabled ? 0.45 : 1 }}>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <NumberInput
        size="sm"
        w={140}
        suffix={` ${unit}`}
        min={min}
        max={max}
        step={step}
        allowDecimal={!integer}
        value={integer ? Math.round(value) : Number(value.toFixed(2))}
        disabled={disabled || !onChange}
        onChange={(v) => onChange && typeof v === "number" && onChange(v)}
      />
    </Group>
  );
}
