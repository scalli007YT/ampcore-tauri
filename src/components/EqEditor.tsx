import { useMemo } from "react";
import { Button, NumberInput, Select, Stack, Text } from "@mantine/core";
import { buildResponseCurve, type ResponsePoint } from "../lib/filterResponse";
import {
  commands,
  type AmpAssignment,
  type AmpCapability_Serialize as AmpCapability,
  type ChannelEq,
  type CrossoverFilterType,
  type CrossoverSlotKind,
  type EqDirection,
  type EqFilterType,
  type Project,
} from "../lib/bindings";

/** `filterType -> {supportsGain, supportsQ}` lookup, keyed for O(1) access —
 * built once from `AmpCapability.eqFilterCapabilities`, the backend-resolved
 * source of truth (`eq_filter_capabilities()` in
 * `src-tauri/src/data/capability/mod.rs`). Not hardcoded here: if a future
 * model/firmware ever needs a different gain/Q table, this stays correct
 * automatically, same as every other capability this app reads off
 * `AmpCapability` instead of assuming per-model.  */
function indexEqFilterCapabilities(
  entries: AmpCapability["eqFilterCapabilities"],
): Record<EqFilterType, { supportsGain: boolean; supportsQ: boolean }> {
  const map = {} as Record<EqFilterType, { supportsGain: boolean; supportsQ: boolean }>;
  for (const entry of entries) {
    map[entry.filterType] = { supportsGain: entry.supportsGain, supportsQ: entry.supportsQ };
  }
  return map;
}

/** `AmpChannel.inputEq`/`outputEq` are typed optional in TS (specta marks
 * any `#[serde(default = ...)]` field optional) even though the backend's
 * default constructor guarantees they're always populated. This fallback
 * mirrors that backend default (`default_channel_eq` in
 * `src-tauri/src/data/project.rs`) so the graph/editor never has to handle
 * a missing chain. */
const FALLBACK_CHANNEL_EQ: ChannelEq = {
  hp: { filterType: "butterworth12", freqHz: 20, active: false },
  bands: Array.from({ length: 8 }, () => ({
    filterType: "peaking" as EqFilterType,
    freqHz: 1000,
    gainDb: 0,
    q: 1,
    active: false,
  })),
  lp: { filterType: "butterworth12", freqHz: 20000, active: false },
};

const EQ_FILTER_LABELS: Record<EqFilterType, string> = {
  peaking: "Peaking",
  lowShelf: "Low Shelf",
  highShelf: "High Shelf",
  allPass1st: "All-Pass 1st",
  allPass2nd: "All-Pass 2nd",
  generalLow: "General LP",
  generalHigh: "General HP",
  butterworthLow: "Butterworth LP",
  butterworthHigh: "Butterworth HP",
  besselLow: "Bessel LP",
  besselHigh: "Bessel HP",
};

const CROSSOVER_FILTER_LABELS: Record<CrossoverFilterType, string> = {
  butterworth12: "BW-12",
  bessel12: "Bessel-12",
  linkwitzRiley12: "L-R 12",
  butterworth18: "BW-18",
  butterworth24: "BW-24",
  bessel24: "Bessel-24",
  linkwitzRiley24: "L-R 24",
  butterworth36: "BW-36",
  butterworth48: "BW-48",
  bessel48: "Bessel-48",
  linkwitzRiley48: "L-R 48",
};

const EQ_FILTER_OPTIONS = (Object.keys(EQ_FILTER_LABELS) as EqFilterType[]).map((value) => ({
  value,
  label: EQ_FILTER_LABELS[value],
}));
const CROSSOVER_FILTER_OPTIONS = (Object.keys(CROSSOVER_FILTER_LABELS) as CrossoverFilterType[]).map((value) => ({
  value,
  label: CROSSOVER_FILTER_LABELS[value],
}));

const GRAPH_WIDTH = 1000;
const GRAPH_HEIGHT = 420;
/** Shared cap so the graph and the band strip below it line up edge to
 * edge, rather than the graph (self-limited by its own aspect ratio) ending
 * up narrower than the full-width strip on large windows. */
const EDITOR_MAX_WIDTH = 1500;
const GRAPH_MIN_DB = -24;
const GRAPH_MAX_DB = 24;
const GRAPH_MIN_HZ = 20;
const GRAPH_MAX_HZ = 20000;
const GRID_FREQS_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GRID_DB = [-24, -18, -12, -6, 0, 6, 12, 18, 24];

function xForFreq(freqHz: number): number {
  const clamped = Math.min(GRAPH_MAX_HZ, Math.max(GRAPH_MIN_HZ, freqHz));
  const t = (Math.log10(clamped) - Math.log10(GRAPH_MIN_HZ)) / (Math.log10(GRAPH_MAX_HZ) - Math.log10(GRAPH_MIN_HZ));
  return t * GRAPH_WIDTH;
}

function yForDb(db: number): number {
  const clamped = Math.min(GRAPH_MAX_DB, Math.max(GRAPH_MIN_DB, db));
  const t = (clamped - GRAPH_MIN_DB) / (GRAPH_MAX_DB - GRAPH_MIN_DB);
  return GRAPH_HEIGHT - t * GRAPH_HEIGHT;
}

function pathFor(points: ResponsePoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${xForFreq(p.freqHz).toFixed(2)} ${yForDb(p.db).toFixed(2)}`).join(" ");
}

function freqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/** Frequency-response graph — log-Hz x-axis, dB y-axis, one path built from
 * the real composite filter magnitude response (see `filterResponse.ts`),
 * with a numbered marker at each active parametric band's (freq, gain)
 * position.
 *
 * Sizing matches the old app's reference (`components/monitor/amp-tabs/
 * eq-curve-chart.tsx` in cvr-amp-controller-web): plain `width: 100%;
 * height: auto` against the `viewBox`'s intrinsic ratio — no
 * `preserveAspectRatio="none"`, no CSS `aspect-ratio`/`maxHeight` tricks, no
 * flexbox contain-fit. The reference never tries to force the graph into an
 * exact height budget either — it caps its *dialog's width*
 * (`w-[min(64rem,95vw)]`) and lets height follow naturally from that, with
 * the surrounding dialog scrolling if content doesn't fit vertically. This
 * component follows the same principle: `EDITOR_MAX_WIDTH` bounds the
 * width (so height, derived from it, stays reasonable), and the containing
 * panel in `AmpConfigureView.tsx` scrolls as the fallback — not an
 * `<svg>` sizing problem to solve on its own. SVG, not Canvas: declarative,
 * crisp at any DPI, trivial at ~800 points. */
function ResponseGraph({ points, eq }: { points: ResponsePoint[]; eq: ChannelEq }) {
  const zeroDbY = yForDb(0);
  const fillPath = `${pathFor(points)} L ${GRAPH_WIDTH} ${zeroDbY} L 0 ${zeroDbY} Z`;

  return (
    <svg
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      className="rounded-[var(--mantine-radius-sm)]"
      style={{
        backgroundColor: "var(--mantine-color-dark-8)",
        display: "block",
        width: "100%",
        height: "auto",
      }}
    >
      {GRID_FREQS_HZ.map((hz) => (
        <line
          key={hz}
          x1={xForFreq(hz)}
          x2={xForFreq(hz)}
          y1={0}
          y2={GRAPH_HEIGHT}
          stroke="var(--mantine-color-dark-5)"
          strokeWidth={1}
        />
      ))}
      {GRID_DB.map((db) => (
        <line
          key={db}
          x1={0}
          x2={GRAPH_WIDTH}
          y1={yForDb(db)}
          y2={yForDb(db)}
          stroke="var(--mantine-color-dark-5)"
          strokeWidth={1}
        />
      ))}
      <line x1={0} x2={GRAPH_WIDTH} y1={zeroDbY} y2={zeroDbY} stroke="var(--mantine-color-dark-3)" strokeWidth={1} />
      <path d={fillPath} fill="var(--mantine-color-dark-4)" opacity={0.35} stroke="none" />
      <path d={pathFor(points)} fill="none" stroke="var(--mantine-color-amber-filled)" strokeWidth={2} />
      {eq.bands.map((band, i) => {
        if (!band.active) return null;
        const x = xForFreq(band.freqHz ?? 1000);
        const y = yForDb(band.gainDb ?? 0);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={5} fill="var(--mantine-color-body)" stroke="var(--mantine-color-text)" strokeWidth={1.5} />
            <text x={x} y={y + 18} fontSize={11} textAnchor="middle" fill="var(--mantine-color-text)">
              {i + 1}
            </text>
          </g>
        );
      })}
      {GRID_FREQS_HZ.map((hz) => (
        <text key={hz} x={xForFreq(hz) + 3} y={GRAPH_HEIGHT - 4} fontSize={9} fill="var(--mantine-color-dimmed)">
          {freqLabel(hz)}
        </text>
      ))}
      {GRID_DB.map((db) => (
        <text key={db} x={3} y={yForDb(db) - 3} fontSize={9} fill="var(--mantine-color-dimmed)">
          {db > 0 ? `+${db}` : db}
        </text>
      ))}
    </svg>
  );
}

interface EqEditorProps {
  assignment: AmpAssignment;
  project: Project;
  channelIndex: number;
  direction: EqDirection;
  capability: AmpCapability;
  onProjectUpdate: (project: Project) => void;
}

/** Full EQ editor for one channel's 10-band chain (HP crossover + 8
 * parametric bands + LP crossover) — shared by the Input and Output tabs'
 * EQ sub-tabs. Full-width graph + a strip of all 10 bands' controls always
 * visible at once (matching the old app's reference layout), rather than a
 * pick-one-band-then-edit flow. Reads `channel.inputEq`/`outputEq` per
 * `direction`. */
export function EqEditor({ assignment, project, channelIndex, direction, capability, onProjectUpdate }: EqEditorProps) {
  const channel = assignment.channels.find((c) => c.channelIndex === channelIndex) ?? assignment.channels[0];
  const eq = (direction === "input" ? channel.inputEq : channel.outputEq) ?? FALLBACK_CHANNEL_EQ;

  const points = useMemo(() => buildResponseCurve(eq), [eq]);
  const eqCapsByType = useMemo(
    () => indexEqFilterCapabilities(capability.eqFilterCapabilities),
    [capability.eqFilterCapabilities],
  );

  const freqRange = capability.paramRanges.crossoverFreqHz;
  const gainRange = capability.paramRanges.eqBandGainDb;
  const qRange = capability.paramRanges.eqBandQ;

  async function handleCrossoverChange(
    slot: CrossoverSlotKind,
    patch: Partial<{ filterType: CrossoverFilterType; freqHz: number; active: boolean }>,
  ) {
    const result = await commands.projectsSetCrossoverSlot(project.id, assignment.id, channelIndex, direction, slot, {
      filterType: patch.filterType ?? null,
      freqHz: patch.freqHz ?? null,
      active: patch.active ?? null,
    });
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  async function handleBandChange(
    bandIndex: number,
    patch: Partial<{ filterType: EqFilterType; freqHz: number; gainDb: number; q: number; active: boolean }>,
  ) {
    const result = await commands.projectsSetEqBand(project.id, assignment.id, channelIndex, direction, bandIndex, {
      filterType: patch.filterType ?? null,
      freqHz: patch.freqHz ?? null,
      gainDb: patch.gainDb ?? null,
      q: patch.q ?? null,
      active: patch.active ?? null,
    });
    if (result.status === "ok") {
      onProjectUpdate(result.data);
    }
  }

  return (
    <Stack
      gap="md"
      p="md"
      style={{
        maxWidth: EDITOR_MAX_WIDTH,
        margin: "0 auto",
      }}
    >
      <ResponseGraph points={points} eq={eq} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${2 + eq.bands.length}, 1fr)`,
          gap: 8,
        }}
      >
        <CrossoverStrip
          label="HP"
          slot={eq.hp}
          freqMin={freqRange.min}
          freqMax={freqRange.max}
          onChange={(patch) => handleCrossoverChange("hp", patch)}
        />
        {eq.bands.map((band, i) => (
          <BandStrip
            key={i}
            label={String(i + 1)}
            band={band}
            capsByType={eqCapsByType}
            freqMin={freqRange.min}
            freqMax={freqRange.max}
            gainMin={gainRange.min}
            gainMax={gainRange.max}
            qMin={qRange.min}
            qMax={qRange.max}
            onChange={(patch) => handleBandChange(i, patch)}
          />
        ))}
        <CrossoverStrip
          label="LP"
          slot={eq.lp}
          freqMin={freqRange.min}
          freqMax={freqRange.max}
          onChange={(patch) => handleCrossoverChange("lp", patch)}
        />
      </div>
    </Stack>
  );
}

/** Status pill for a crossover slot's/band's `active` flag — labels the
 * *current state* ("Enabled"/"Bypassed"), not the click action. Enabled
 * uses a green tint at half the intensity of Mantine's own `variant="light"`
 * (via `color-mix` against its own light-variant background var, so it
 * still adapts correctly to light/dark scheme); bypassed stays a plain
 * muted/default button. */
function ActiveStateButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <Button
      size="sm"
      fullWidth
      variant="default"
      onClick={onClick}
      styles={
        active
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
      {active ? "Enabled" : "Bypassed"}
    </Button>
  );
}

/** One compact vertical control column — shared visual shell for both the
 * crossover slots and the parametric bands, so the 10-column strip lines up
 * evenly regardless of which fields a given filter type exposes. */
function StripShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={4} p={6} bdrs="sm" bd="1px solid var(--mantine-color-default-border)" className="min-w-0">
      <Text size="sm" fw={700} c="dimmed" ta="center">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

function CrossoverStrip({
  label,
  slot,
  freqMin,
  freqMax,
  onChange,
}: {
  label: string;
  slot: { filterType: CrossoverFilterType; freqHz: number | null; active: boolean };
  freqMin: number | null;
  freqMax: number | null;
  onChange: (patch: Partial<{ filterType: CrossoverFilterType; freqHz: number; active: boolean }>) => void;
}) {
  return (
    <StripShell label={label}>
      <Select
        size="sm"
        data={CROSSOVER_FILTER_OPTIONS}
        value={slot.filterType}
        onChange={(value) => value && onChange({ filterType: value as CrossoverFilterType })}
        allowDeselect={false}
      />
      <NumberInput
        size="sm"
        suffix=" Hz"
        min={freqMin ?? undefined}
        max={freqMax ?? undefined}
        value={slot.freqHz ?? 0}
        onChange={(value) => typeof value === "number" && onChange({ freqHz: value })}
      />
      {/* No gain/Q for crossover slots — Q is implied by filterType, never
       * user-settable (see CrossoverSlot in filterResponse.ts). Spacers
       * keep this column's row heights aligned with BandStrip's. */}
      <div style={{ height: 36 }} />
      <div style={{ height: 36 }} />
      <ActiveStateButton active={slot.active} onClick={() => onChange({ active: !slot.active })} />
    </StripShell>
  );
}

function BandStrip({
  label,
  band,
  capsByType,
  freqMin,
  freqMax,
  gainMin,
  gainMax,
  qMin,
  qMax,
  onChange,
}: {
  label: string;
  band: { filterType: EqFilterType; freqHz: number | null; gainDb: number | null; q: number | null; active: boolean };
  capsByType: Record<EqFilterType, { supportsGain: boolean; supportsQ: boolean }>;
  freqMin: number | null;
  freqMax: number | null;
  gainMin: number | null;
  gainMax: number | null;
  qMin: number | null;
  qMax: number | null;
  onChange: (patch: Partial<{ filterType: EqFilterType; freqHz: number; gainDb: number; q: number; active: boolean }>) => void;
}) {
  const caps = capsByType[band.filterType];
  return (
    <StripShell label={label}>
      <Select
        size="sm"
        data={EQ_FILTER_OPTIONS}
        value={band.filterType}
        onChange={(value) => value && onChange({ filterType: value as EqFilterType })}
        allowDeselect={false}
      />
      <NumberInput
        size="sm"
        suffix=" Hz"
        min={freqMin ?? undefined}
        max={freqMax ?? undefined}
        value={band.freqHz ?? 0}
        onChange={(value) => typeof value === "number" && onChange({ freqHz: value })}
      />
      {caps.supportsGain ? (
        <NumberInput
          size="sm"
          suffix=" dB"
          step={0.5}
          min={gainMin ?? undefined}
          max={gainMax ?? undefined}
          value={band.gainDb ?? 0}
          onChange={(value) => typeof value === "number" && onChange({ gainDb: value })}
        />
      ) : (
        <div style={{ height: 36 }} />
      )}
      {caps.supportsQ ? (
        <NumberInput
          size="sm"
          suffix=" Q"
          step={0.1}
          min={qMin ?? undefined}
          max={qMax ?? undefined}
          value={band.q ?? 1}
          onChange={(value) => typeof value === "number" && onChange({ q: value })}
        />
      ) : (
        <div style={{ height: 36 }} />
      )}
      <ActiveStateButton active={band.active} onClick={() => onChange({ active: !band.active })} />
    </StripShell>
  );
}
