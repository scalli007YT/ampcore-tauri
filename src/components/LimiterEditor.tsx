import { useEffect, useState } from "react";
import { Button, Divider, Group, NumberInput, Slider, Stack, Text } from "@mantine/core";
import {
  commands,
  type AmpAssignment,
  type AmpCapability_Serialize as AmpCapability,
  type Limiter,
  type Project,
} from "../lib/bindings";

const EDITOR_MAX_WIDTH = 640;
const SLIDER_HEIGHT = 220;
const METER_SCALE_DB = [0, -8, -16, -24, -32, -40];
/** Vertical analogue of `MockLevelMeter`'s gradient elsewhere in the app —
 * same decorative-only rationale (no live device data exists yet in this
 * offline-planning phase). */
const METER_GRADIENT = "linear-gradient(to top, #0f6e5c 0%, #2f9e6a 35%, #d4c94a 65%, #e0793a 82%, #d64545 100%)";

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

/** The Peak threshold's floor: at least double the RMS threshold voltage,
 * capped at `peakMax` so the floor itself never exceeds what the model/range
 * allows. Shared by `patch()`'s async enforcement and the sliders'/fields'
 * `min` props so dragging or typing can't dip below the floor in the first
 * place, rather than only correcting it after the fact. */
function requiredPeakFloor(rmsVoltage: number, peakMax: number): number {
  return Math.min(rmsVoltage * 2, peakMax);
}

/** Peak voltage capability assumed relative to an amp's rated RMS voltage —
 * used to auto-derive the Peak stage's max threshold from the same
 * per-model rating that caps the RMS stage. Set to 2 (not the sine-wave
 * √2 crest factor) to stay consistent with the "Peak threshold must be at
 * least double the RMS threshold" floor enforced in `patch()`: if this were
 * smaller than 2, the floor would become unreachable once RMS threshold
 * rises above half of `ratedRmsVoltage`. */
const PEAK_HEADROOM_FACTOR = 2;

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
    // Peak threshold must always be at least double the RMS threshold
    // (voltage, not Watts — doubling voltage quadruples power), enforced
    // centrally here so it holds regardless of which control (slider,
    // Threshold field, or the interchangeable Prms/Ppeak Wattage fields)
    // triggered the change. Editing RMS upward bumps Peak up to the new
    // floor if it's now too low; editing Peak below the current floor
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

  async function handleOhmsChange(value: number) {
    const result = await commands.projectsSetChannelOhms(project.id, assignment.id, channelIndex, value);
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

  return (
    <Stack gap="md" p="md" align="center" style={{ maxWidth: EDITOR_MAX_WIDTH, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, width: "100%" }}>
        <ThresholdSliderColumn
          label="RMS"
          value={rmsPowerWatts(rmsThresholdVrms, ohms)}
          min={rmsRange.min != null ? rmsPowerWatts(rmsRange.min, ohms) : 0}
          max={rmsPowerWatts(rmsThresholdMax, ohms)}
          step={SLIDER_WATT_STEP}
          disabled={!limiter.rms.enabled}
          onChangeEnd={(watts) =>
            patch({ rmsThresholdVrms: Math.min(voltageForPowerWatts(watts, ohms), rmsThresholdMax) })
          }
        />
        <MeterColumn label="Out dB" gradient valueText="---" />
        <MeterColumn label="Limit dB" valueText="0.0 dB" />
        <ThresholdSliderColumn
          label="Peak"
          value={peakPowerWatts(peakThresholdVp, ohms)}
          min={peakRange.min != null ? peakPowerWatts(peakRange.min, ohms) : 0}
          max={peakPowerWatts(peakThresholdMax, ohms)}
          floor={peakPowerWatts(peakThresholdMin, ohms)}
          step={SLIDER_WATT_STEP}
          disabled={!limiter.peak.enabled}
          onChangeEnd={(watts) =>
            patch({ peakThresholdVp: Math.min(voltageForPowerWatts(watts, ohms), peakThresholdMax) })
          }
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, width: "100%", alignItems: "end" }}>
        <OnOffButton enabled={limiter.rms.enabled} onClick={() => patch({ rmsEnabled: !limiter.rms.enabled })} />
        <div style={{ gridColumn: "span 2" }}>
          <NumberInput
            size="sm"
            label="Load"
            suffix=" Ω"
            min={0.5}
            step={0.5}
            value={ohms}
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
            value={rmsThresholdVrms}
            min={rmsRange.min ?? undefined}
            max={rmsThresholdMax}
            disabled={!limiter.rms.enabled}
            onChange={(value) => patch({ rmsThresholdVrms: value })}
          />
          <LimiterFieldRow
            label="Prms"
            unit="W"
            value={rmsPowerWatts(rmsThresholdVrms, ohms)}
            min={rmsRange.min != null ? rmsPowerWatts(rmsRange.min, ohms) : undefined}
            max={rmsPowerWatts(rmsThresholdMax, ohms)}
            disabled={!limiter.rms.enabled}
            integer
            onChange={(watts) => patch({ rmsThresholdVrms: Math.min(voltageForPowerWatts(watts, ohms), rmsThresholdMax) })}
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
            value={peakThresholdVp}
            min={peakThresholdMin}
            max={peakThresholdMax}
            disabled={!limiter.peak.enabled}
            onChange={(value) => patch({ peakThresholdVp: value })}
          />
          <LimiterFieldRow
            label="Ppeak"
            unit="W"
            value={peakPowerWatts(peakThresholdVp, ohms)}
            min={peakPowerWatts(peakThresholdMin, ohms)}
            max={peakPowerWatts(peakThresholdMax, ohms)}
            disabled={!limiter.peak.enabled}
            integer
            onChange={(watts) => patch({ peakThresholdVp: Math.min(voltageForPowerWatts(watts, ohms), peakThresholdMax) })}
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

/** Decorative vertical meter — `Out dB` shows a static gradient with no
 * marker line (no live device connected in this offline-planning phase);
 * `Limit dB` (gain reduction) shows a plain, unfilled track. Purely visual,
 * mirrors `MockLevelMeter`'s rationale elsewhere in this file. */
function MeterColumn({ label, gradient, valueText }: { label: string; gradient?: boolean; valueText: string }) {
  return (
    <Stack gap={8} align="center">
      <Text size="sm" fw={700} c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Group gap={6} wrap="nowrap" align="stretch" h={SLIDER_HEIGHT}>
        <div
          className="rounded-[var(--mantine-radius-sm)]"
          style={{
            width: 22,
            height: "100%",
            background: gradient ? METER_GRADIENT : "var(--mantine-color-dark-6)",
            opacity: gradient ? 0.25 : 1,
          }}
        />
        <Stack gap={0} justify="space-between" h="100%" py={2}>
          {METER_SCALE_DB.map((db) => (
            <Text key={db} fz={9} c="dimmed">
              {db}
            </Text>
          ))}
        </Stack>
      </Group>
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
